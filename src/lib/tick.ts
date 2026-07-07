// Server-only orchestration for the scheduled tick (SPECS.md §7.6).
//
// Pulls everything together: token refresh (both providers), To Do sync,
// queue-driven selection (head of the "Up Next" queue) + exhaustion handling,
// transactional locking, retry-safe two-step publish, and per-post write-back. Publishing
// always goes through buildSegments(composeFullText(thought), thought.year) so
// the year suffix (req. 1), multi-thread split (req. 2) and included note
// (req. 3) are honoured at publish time — exactly what the UI previews (req. 4).

import {
  acquireLock,
  appendPost,
  getConfig,
  getThought,
  getTokenState,
  releaseLock,
  reshufflePublished,
  updateConfig,
  updateThought,
} from "./firestore";
import {
  completeTask,
  refreshAccessToken,
  refreshThoughtFromTask,
  syncTasks,
} from "./microsoft";
import {
  isRateLimitError,
  maybeRefreshLongLived,
  publishSegments,
} from "./threads";
import { buildSegments, composeFullText } from "./post";
import { isScheduledDay } from "./schedule";
import { reconcileQueue, refillQueue, rotateToBack } from "./queue";
import { notify } from "./notify";
import type { AppConfig, Thought } from "./types";

/** Lock TTL — a stale lock older than this can be re-acquired (SPECS.md §7.7). */
const LOCK_TTL_MS = 10 * 60 * 1000;

/** A thought becomes terminally `failed` after this many publish attempts. */
const MAX_ATTEMPTS = 3;

// --- selection (SPECS.md §7.4) ------------------------------------------

/**
 * Select the next thought to publish: the head of the "Up Next" queue. Reconcile
 * first (honouring a user-reduced queue without topping it back up mid-select);
 * only when the queue is genuinely empty do we refill from the pool. Returns null
 * when the pool is empty too (after applying the configured exhaustion behaviour).
 */
export async function selectThought(
  config: AppConfig
): Promise<Thought | null> {
  const reconciled = await reconcileQueue(config);
  if (reconciled.length > 0) return reconciled[0];
  const refilled = await refillQueue(config);
  if (refilled.length > 0) return refilled[0];
  return handleExhaustion(config);
}

/**
 * Pool is empty. `stop` -> alert and publish nothing. `reshuffle` -> reset
 * published thoughts back to unpublished and re-select once.
 */
export async function handleExhaustion(
  config: AppConfig
): Promise<Thought | null> {
  if (config.onExhaustion === "reshuffle") {
    const n = await reshufflePublished();
    await notify(
      `Thought pool exhausted; reshuffled ${n} published thought(s) back into the pool.`,
      { event: "reshuffle", count: n }
    );
    const queue = await refillQueue(config);
    return queue.length > 0 ? queue[0] : null;
  }
  // Default: stop. Debounce the alert so a daily cron doesn't fire every run
  // once the pool empties — notify at most once per ~20h (on entering the state).
  const lastIso = config.lastExhaustionNotifiedAt;
  const ageMs = lastIso
    ? Date.now() - new Date(lastIso).getTime()
    : Number.POSITIVE_INFINITY;
  if (ageMs > 20 * 60 * 60 * 1000) {
    await notify(
      "Thought pool exhausted; nothing to publish (onExhaustion=stop).",
      { event: "exhausted" }
    );
    await updateConfig({
      lastExhaustionNotifiedAt: new Date().toISOString(),
    }).catch(() => {});
  }
  return null;
}

// --- publish one (SPECS.md §7.5–§7.7) -----------------------------------

export type PublishStatus =
  | "published"
  | "skipped"
  | "failed"
  | "ratelimited"
  | "exhausted";

export interface PublishOutcome {
  status: PublishStatus;
  thoughtId?: string;
  reason?: string;
  permalink?: string | null;
  threadsPostId?: string;
  segments?: number;
  error?: string;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}

/**
 * Select, lock, and publish a single thought. Safe to call repeatedly; the
 * transactional lock + terminal `published` status prevent double-posting.
 */
export async function publishOne(
  config?: AppConfig,
  accessToken?: string
): Promise<PublishOutcome> {
  const cfg = config ?? (await getConfig());

  // A pre-publish refresh can archive the selected thought (un-starred /
  // completed / deleted in To Do). Re-select the next one when that happens,
  // bounded so a pathological state can't spin forever.
  const MAX_RESELECT = 10;
  for (let attempt = 0; attempt < MAX_RESELECT; attempt++) {
    let thought = await selectThought(cfg);
    if (!thought) return { status: "exhausted" };

    // Transactional lock: only succeeds if still unpublished and unlocked/stale.
    const locked = await acquireLock(thought.id, LOCK_TTL_MS);
    if (!locked) {
      return { status: "skipped", thoughtId: thought.id, reason: "locked" };
    }

    // Sync the exact task right before posting so last-minute To Do edits are
    // captured. Best-effort: a Graph failure must never block publishing — fall
    // back to the stored content (mirrors "publish even when Microsoft is down").
    //
    // Skip the refresh once a chain is already partway posted: publishSegments
    // resumes by segment COUNT (alreadyPublishedIds.length), so changing the text
    // mid-chain would re-segment and post mismatched/duplicated content. An
    // in-progress chain must finish with the exact content it started with.
    const chainInProgress = (thought.publishedSegmentIds?.length ?? 0) > 0;
    if (accessToken && !chainInProgress) {
      try {
        const refreshed = await refreshThoughtFromTask(
          accessToken,
          thought.listId,
          thought.id
        );
        if (refreshed.gone) {
          // Already archived inside refreshThoughtFromTask; skip to the next.
          await releaseLock(thought.id);
          continue;
        }
        // Publish the freshest content.
        thought = (await getThought(thought.id)) ?? thought;
      } catch (e) {
        await notify("Pre-publish To Do refresh failed; posting stored content.", {
          event: "prepublish_refresh_failed",
          thoughtId: thought.id,
          error: errMsg(e),
        });
      }
    }

    const outcome = await publishLocked(thought, cfg, accessToken);
    return outcome;
  }

  // Exhausted the re-select budget (every candidate was archived on refresh).
  return { status: "exhausted" };
}

/**
 * Publish a thought that has already been selected, locked, and refreshed.
 * Handles segment composition, the retry-safe two-step publish, write-back, and
 * lock release. Split out of publishOne so the selection/refresh loop stays
 * readable.
 */
async function publishLocked(
  thought: Thought,
  cfg: AppConfig,
  accessToken?: string
): Promise<PublishOutcome> {
  try {
    const segments = buildSegments(composeFullText(thought), thought.year);

    // Nothing publishable — flag it so it stops being selected, and bail.
    if (segments.length === 0) {
      await updateThought(thought.id, {
        skip: true,
        lastError: "Empty content after composition; nothing to publish.",
      });
      await releaseLock(thought.id);
      return { status: "skipped", thoughtId: thought.id, reason: "empty" };
    }

    // Resume a partially-published chain instead of restarting it. priorIds are
    // the media ids already posted on an earlier failed attempt (SPECS.md §7.7).
    const priorIds = thought.publishedSegmentIds ?? [];
    const accumulated = [...priorIds];

    let result: { rootId: string; permalink: string | null };
    try {
      result = await publishSegments(segments, {
        alreadyPublishedIds: priorIds,
        onProgress: async (mediaId) => {
          accumulated.push(mediaId);
          // Persist progress after each segment so a mid-chain failure resumes
          // rather than re-posting already-published segments (no double-post).
          await updateThought(thought.id, {
            publishedSegmentIds: [...accumulated],
          });
        },
      });
    } catch (e) {
      const message = errMsg(e);
      const attempts = thought.attempts + 1;

      if (isRateLimitError(e)) {
        // Leave unpublished (don't escalate to failed); skip the rest of the run.
        await updateThought(thought.id, { attempts, lastError: message });
        await releaseLock(thought.id);
        await notify("Threads rate limit hit; leaving thought unpublished.", {
          event: "ratelimit",
          thoughtId: thought.id,
        });
        return { status: "ratelimited", thoughtId: thought.id, error: message };
      }

      const patch: Partial<Thought> = { attempts, lastError: message };
      if (attempts >= MAX_ATTEMPTS) {
        patch.status = "failed";
        // Terminal: clear resume state so a future reshuffle starts clean.
        patch.publishedSegmentIds = [];
      } else {
        // Still retryable: rotate it to the back of the queue so a stuck head
        // doesn't block the rest of a multi-post run. Best-effort.
        await rotateToBack(thought.id).catch(() => {});
      }
      await updateThought(thought.id, patch);
      await releaseLock(thought.id);
      await notify("Publish to Threads failed.", {
        event: "publish_failed",
        thoughtId: thought.id,
        attempts,
        error: message,
      });
      return { status: "failed", thoughtId: thought.id, error: message };
    }

    // Success — terminal state so retries can't re-select it.
    const publishedAtIso = new Date().toISOString();
    await updateThought(thought.id, {
      status: "published",
      threadsPostId: result.rootId,
      permalink: result.permalink ?? null,
      publishedAt: publishedAtIso,
      attempts: thought.attempts + 1,
      lastError: null,
      creationId: null,
      publishedSegmentIds: [],
    });

    // A successful publish means the pool is no longer exhausted — reset the
    // debounce so the next exhaustion alerts again (transition-based alerting).
    if (cfg.lastExhaustionNotifiedAt) {
      await updateConfig({ lastExhaustionNotifiedAt: null }).catch(() => {});
    }

    await appendPost({
      thoughtId: thought.id,
      text: segments.join("\n"),
      segments,
      threadsPostId: result.rootId,
      permalink: result.permalink ?? "",
      publishedAt: publishedAtIso,
      status: "success",
      error: null,
    });

    // Optional write-back to To Do (best-effort; never fails the publish).
    if (cfg.writeBackComplete) {
      if (accessToken) {
        try {
          await completeTask(accessToken, thought.listId, thought.id);
        } catch (e) {
          await notify("To Do write-back (complete) failed.", {
            event: "writeback_failed",
            thoughtId: thought.id,
            error: errMsg(e),
          });
        }
      } else {
        await notify(
          "writeBackComplete is on but no Microsoft access token was available; skipped.",
          { event: "writeback_skipped", thoughtId: thought.id }
        );
      }
    }

    await releaseLock(thought.id);
    return {
      status: "published",
      thoughtId: thought.id,
      permalink: result.permalink ?? null,
      threadsPostId: result.rootId,
      segments: segments.length,
    };
  } catch (e) {
    // Unexpected error after locking — never leave the lock held.
    const message = errMsg(e);
    await updateThought(thought.id, {
      attempts: thought.attempts + 1,
      lastError: message,
    }).catch(() => {});
    await releaseLock(thought.id).catch(() => {});
    return { status: "failed", thoughtId: thought.id, error: message };
  }
}

// --- the tick (SPECS.md §7.6) -------------------------------------------

export interface TickResult {
  ok: boolean;
  manual: boolean;
  skipped?: "paused" | "reauth" | "offschedule";
  error?: string;
  synced?: { added: number; updated: number; archived: number } | null;
  published: number;
  outcomes: PublishOutcome[];
}

/**
 * Full scheduled-tick orchestration (minus the CRON_SECRET check, which the
 * route handler performs). Refreshes both tokens, syncs To Do, then publishes
 * up to `postsPerRun` thoughts. Fatal errors are caught + notified.
 */
export async function runTick(
  { manual = false }: { manual?: boolean } = {}
): Promise<TickResult> {
  const base: TickResult = { ok: true, manual, published: 0, outcomes: [] };

  try {
    const config = await getConfig();
    if (config.paused) return { ...base, skipped: "paused" };

    // Day-of-week gate. The cron fires daily at 09:00 KST; publish only on the
    // configured weekdays (evaluated in config.timezone). Manual runs bypass it.
    if (!manual && !isScheduledDay(config.scheduleDays, config.timezone, new Date())) {
      return { ...base, skipped: "offschedule" };
    }

    const tokens = await getTokenState();
    if (tokens.msNeedsReauth || tokens.threadsNeedsReauth) {
      return { ...base, skipped: "reauth" };
    }

    // Refresh Microsoft (rotates refresh token) — throws + flags on 4xx.
    const accessToken = await refreshAccessToken();
    // Refresh Threads long-lived token if >24h old — throws + flags on failure.
    await maybeRefreshLongLived();

    // Sync from To Do (requires a configured source list).
    let synced: TickResult["synced"] = null;
    if (config.sourceListId) {
      synced = await syncTasks(accessToken, config.sourceListId);
    } else {
      await notify("Tick: no sourceListId configured; skipping sync.", {
        event: "no_source_list",
      });
    }

    // Publish up to postsPerRun thoughts.
    const outcomes: PublishOutcome[] = [];
    let published = 0;
    const runs = Math.max(0, Math.floor(config.postsPerRun || 0));
    for (let i = 0; i < runs; i++) {
      const outcome = await publishOne(config, accessToken);
      outcomes.push(outcome);
      if (outcome.status === "published") published++;
      // Stop early on exhaustion or a rate limit (skip the rest of the run).
      if (outcome.status === "exhausted" || outcome.status === "ratelimited") {
        break;
      }
    }

    // Repopulate "Up Next" to queueSize for the next cycle (after consuming this
    // run's heads). Best-effort — a refill failure must not fail the tick.
    await refillQueue(config).catch(() => {});

    return { ok: true, manual, synced, published, outcomes };
  } catch (e) {
    const message = errMsg(e);
    await notify("Tick failed.", { event: "tick_failed", manual, error: message });
    return { ...base, ok: false, error: message };
  }
}

/**
 * Manual "Publish now" path. Unlike the scheduled tick, this does NOT sync To Do
 * and does NOT require a healthy Microsoft connection — it only needs Threads,
 * so you can still publish when Microsoft needs re-auth. The Microsoft token is
 * refreshed only when write-back is enabled (best-effort). Runs regardless of
 * `paused` because it is an explicit user action.
 */
export async function runManualPublish(): Promise<TickResult> {
  const base: TickResult = { ok: true, manual: true, published: 0, outcomes: [] };

  try {
    const config = await getConfig();
    const tokens = await getTokenState();
    if (tokens.threadsNeedsReauth) return { ...base, skipped: "reauth" };

    // Refresh the Threads long-lived token if due — required to publish.
    await maybeRefreshLongLived();

    // A Microsoft access token enables the pre-publish To Do refresh (capture
    // last-minute edits) and optional write-back. Failing to get it must not
    // block publishing to Threads — fall back to the stored content.
    let accessToken: string | undefined;
    try {
      accessToken = await refreshAccessToken();
    } catch (e) {
      await notify(
        "Manual publish: Microsoft refresh failed; posting stored content, write-back skipped.",
        { event: "manual_ms_refresh_failed", error: errMsg(e) }
      );
    }

    const outcomes: PublishOutcome[] = [];
    let published = 0;
    // Manual publish posts at least one even if postsPerRun is misconfigured to 0.
    const runs = Math.max(1, Math.floor(config.postsPerRun || 0) || 1);
    for (let i = 0; i < runs; i++) {
      const outcome = await publishOne(config, accessToken);
      outcomes.push(outcome);
      if (outcome.status === "published") published++;
      if (outcome.status === "exhausted" || outcome.status === "ratelimited") {
        break;
      }
    }

    // Repopulate "Up Next" to queueSize for the next cycle (after consuming this
    // run's heads). Best-effort — a refill failure must not fail the publish.
    await refillQueue(config).catch(() => {});

    return { ok: true, manual: true, synced: null, published, outcomes };
  } catch (e) {
    const message = errMsg(e);
    await notify("Manual publish failed.", {
      event: "manual_publish_failed",
      error: message,
    });
    return { ...base, ok: false, error: message };
  }
}
