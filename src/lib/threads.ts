// Server-only Threads Graph API client. Handles OAuth (short -> long-lived
// exchange), the >24h long-lived refresh, and reply-chain publishing.
//
// IMPORTANT: this module persists nothing about thoughts/posts itself — the tick
// layer owns thought state. It only persists Threads TOKEN state (rotation /
// reauth flags), which is its responsibility per the contract.

import { threadsConfig } from "./env";
import { getTokenState, updateTokenState } from "./firestore";
import { notify } from "./notify";

const GRAPH_BASE = "https://graph.threads.net";
const AUTHORIZE_URL = "https://threads.net/oauth/authorize";
const SCOPE = "threads_basic,threads_content_publish";

/** 24h in milliseconds — the minimum age before a long-lived token may refresh. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Tagged error thrown on HTTP 429 so the tick can leave the thought
 * unpublished (and not flip it to failed) when we are rate limited.
 */
export class RateLimitError extends Error {
  readonly isRateLimit = true;
  readonly status = 429;
  constructor(message = "Threads rate limit exceeded (HTTP 429)") {
    super(message);
    this.name = "RateLimitError";
  }
}

export function isRateLimitError(e: unknown): e is RateLimitError {
  return (
    e instanceof RateLimitError ||
    (typeof e === "object" &&
      e !== null &&
      (e as { isRateLimit?: unknown }).isRateLimit === true)
  );
}

// --- low-level helpers ---------------------------------------------------

interface GraphErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

async function readBody(res: Response): Promise<unknown> {
  const txt = await res.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    return { raw: txt };
  }
}

function describeError(status: number, body: unknown): string {
  const b = body as GraphErrorBody;
  const msg = b?.error?.message;
  if (msg) return `${status}: ${msg}`;
  return `${status}: ${JSON.stringify(body)}`;
}

/**
 * Perform a Threads Graph request and parse JSON. Throws RateLimitError on 429
 * and a descriptive Error on any other non-2xx response.
 */
async function graphRequest(
  url: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  const body = await readBody(res);
  if (res.status === 429) {
    throw new RateLimitError(describeError(429, body));
  }
  if (!res.ok) {
    throw new Error(describeError(res.status, body));
  }
  return body as Record<string, unknown>;
}

// --- OAuth ---------------------------------------------------------------

/** Build the Threads authorize URL for the connect flow. */
export function authorizeUrl(state: string): string {
  const { appId, redirectUri } = threadsConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: SCOPE,
    response_type: "code",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for a long-lived (60d) token.
 * 1) code -> short-lived token (+ user_id)
 * 2) short-lived -> long-lived via th_exchange_token
 * Returns the long-lived token and the Threads user id. Persistence of the
 * token is done by the callback route (updateTokenState), not here.
 */
export async function exchangeCodeForLongLived(
  code: string
): Promise<{ token: string; userId: string }> {
  const { appId, appSecret, redirectUri } = threadsConfig();

  // Step 1: short-lived token. This endpoint expects form-encoded params.
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const shortRes = await graphRequest(`${GRAPH_BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const shortToken = String(shortRes.access_token ?? "");
  // user_id may arrive as a number; normalise to string.
  const userId = String(shortRes.user_id ?? "");
  if (!shortToken) {
    throw new Error("Threads: no short-lived access_token in response");
  }

  // Step 2: exchange for long-lived token.
  const exParams = new URLSearchParams({
    grant_type: "th_exchange_token",
    client_secret: appSecret,
    access_token: shortToken,
  });
  const longRes = await graphRequest(
    `${GRAPH_BASE}/access_token?${exParams.toString()}`
  );
  const token = String(longRes.access_token ?? "");
  if (!token) {
    throw new Error("Threads: no long-lived access_token in response");
  }

  return { token, userId };
}

/**
 * Refresh the long-lived token if it is older than 24h. Persists the new token
 * and threadsTokenObtainedAt and clears threadsNeedsReauth on success. On
 * failure sets threadsNeedsReauth, notifies, and rethrows.
 *
 * Returns the current (possibly newly refreshed) token state for convenience.
 */
export async function maybeRefreshLongLived(): Promise<{
  token: string | null;
  refreshed: boolean;
}> {
  const state = await getTokenState();
  const token = state.threadsToken;
  if (!token) {
    return { token: null, refreshed: false };
  }

  const obtainedIso = state.threadsTokenObtainedAt;
  const ageMs = obtainedIso
    ? Date.now() - new Date(obtainedIso).getTime()
    : Number.POSITIVE_INFINITY;

  if (ageMs <= REFRESH_AFTER_MS) {
    // Too fresh to refresh (the API rejects <24h refreshes anyway).
    return { token, refreshed: false };
  }

  try {
    const params = new URLSearchParams({
      grant_type: "th_refresh_token",
      access_token: token,
    });
    const res = await graphRequest(
      `${GRAPH_BASE}/refresh_access_token?${params.toString()}`
    );
    const newToken = String(res.access_token ?? "");
    if (!newToken) {
      throw new Error("Threads: refresh returned no access_token");
    }
    await updateTokenState({
      threadsToken: newToken,
      threadsTokenObtainedAt: new Date(),
      threadsNeedsReauth: false,
    });
    return { token: newToken, refreshed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateTokenState({ threadsNeedsReauth: true });
    await notify("Threads token refresh failed — reconnect required", {
      provider: "threads",
      error: msg,
    });
    throw e;
  }
}

// --- publishing ----------------------------------------------------------

async function resolveAuth(): Promise<{ token: string; userId: string }> {
  const state = await getTokenState();
  if (!state.threadsToken) {
    throw new Error("Threads: no access token stored (reconnect required)");
  }
  if (!state.threadsUserId) {
    throw new Error("Threads: no user id stored (reconnect required)");
  }
  return { token: state.threadsToken, userId: state.threadsUserId };
}

/**
 * Create a single text container and publish it, returning the published media
 * id. When replyToId is provided, the container is created as a reply.
 */
async function publishOneSegment(
  userId: string,
  token: string,
  text: string,
  replyToId: string | null
): Promise<string> {
  // Step 1: create container.
  const createParams = new URLSearchParams({
    media_type: "TEXT",
    text,
    access_token: token,
  });
  if (replyToId) createParams.set("reply_to_id", replyToId);
  const created = await graphRequest(`${GRAPH_BASE}/${userId}/threads`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: createParams.toString(),
  });
  const creationId = String(created.id ?? "");
  if (!creationId) {
    throw new Error("Threads: container creation returned no id");
  }

  // Step 2: publish container.
  const pubParams = new URLSearchParams({
    creation_id: creationId,
    access_token: token,
  });
  const published = await graphRequest(
    `${GRAPH_BASE}/${userId}/threads_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: pubParams.toString(),
    }
  );
  const mediaId = String(published.id ?? "");
  if (!mediaId) {
    throw new Error("Threads: publish returned no media id");
  }
  return mediaId;
}

export interface PublishOptions {
  /**
   * Media ids already published for this chain on a previous (failed) attempt,
   * in order. The first is the root; publishing resumes after the last one so
   * already-posted segments are NOT re-sent (idempotent retry, SPECS.md §7.5/§7.7).
   */
  alreadyPublishedIds?: string[];
  /**
   * Invoked (awaited) immediately after each NEW segment is published, with its
   * media id and segment index. The caller persists progress here so a mid-chain
   * failure can resume instead of restarting.
   */
  onProgress?: (mediaId: string, index: number) => Promise<void> | void;
}

/**
 * Publish an array of segments as a reply chain. Segment 0 is the root; each
 * subsequent segment is published as a reply to the previously published media
 * id. Returns the root media id and its permalink.
 *
 * Resumable: pass `alreadyPublishedIds` to skip segments already sent on a prior
 * attempt and continue the reply chain from the last one. `onProgress` reports
 * each newly published id so the caller can persist chain progress.
 *
 * Throws RateLimitError (HTTP 429) so the caller can leave the thought
 * unpublished. Persists nothing — the tick layer records state.
 */
export async function publishSegments(
  segments: string[],
  opts: PublishOptions = {}
): Promise<{ rootId: string; permalink: string }> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("Threads: publishSegments requires at least one segment");
  }

  const { token, userId } = await resolveAuth();

  const prior = opts.alreadyPublishedIds ?? [];
  let rootId = prior[0] ?? "";
  let previousId: string | null = prior.length ? prior[prior.length - 1] : null;

  // Resume after any already-published segments.
  for (let i = prior.length; i < segments.length; i++) {
    const mediaId = await publishOneSegment(userId, token, segments[i], previousId);
    if (!rootId) rootId = mediaId;
    previousId = mediaId;
    if (opts.onProgress) await opts.onProgress(mediaId, i);
  }

  if (!rootId) {
    throw new Error("Threads: no segments published (nothing to publish)");
  }

  // Fetch the permalink for the root post (best-effort: empty string on miss).
  let permalink = "";
  try {
    const params = new URLSearchParams({
      fields: "permalink",
      access_token: token,
    });
    const meta = await graphRequest(
      `${GRAPH_BASE}/${rootId}?${params.toString()}`
    );
    permalink = String(meta.permalink ?? "");
  } catch (e) {
    // A failed permalink fetch must not undo a successful publish; rethrow only
    // rate-limit errors (unlikely here) so the tick can react consistently.
    if (isRateLimitError(e)) throw e;
    permalink = "";
  }

  return { rootId, permalink };
}

// --- optional quota pre-check -------------------------------------------

export interface PublishingLimit {
  quotaUsage: number | null;
  quotaTotal: number | null;
  raw: Record<string, unknown>;
}

/** GET the current publishing quota usage (optional pre-check). */
export async function publishingLimit(): Promise<PublishingLimit> {
  const { token, userId } = await resolveAuth();
  const params = new URLSearchParams({
    fields: "quota_usage,config",
    access_token: token,
  });
  const res = await graphRequest(
    `${GRAPH_BASE}/${userId}/threads_publishing_limit?${params.toString()}`
  );
  // The payload comes back as { data: [ { quota_usage, config: {...} } ] }.
  const data = Array.isArray(res.data)
    ? (res.data[0] as Record<string, unknown> | undefined)
    : undefined;
  const usage =
    data && typeof data.quota_usage === "number" ? data.quota_usage : null;
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  const total =
    typeof cfg.quota_total === "number" ? cfg.quota_total : null;
  return { quotaUsage: usage, quotaTotal: total, raw: res };
}
