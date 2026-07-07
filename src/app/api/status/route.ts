// GET /api/status — dashboard data: pool stats, recent posts, token health,
// current config, and the next scheduled run (next 00:00 UTC). Reads only —
// never mutates.
//
// The Firestore reads are wrapped in unstable_cache (60s) so the dashboard's
// frequent polling shares one DB refresh per minute instead of scanning the
// store on every request. A request with `?fresh=1` bypasses the cache — the
// client uses that right after an action so the user sees the result instantly.

import { NextResponse, type NextRequest } from "next/server";
import { unstable_cache } from "next/cache";
import { getConfig, getTokenState, listPosts, poolStats } from "@/lib/firestore";
import { nextScheduledRunIso } from "@/lib/schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
/** Long-lived Threads token lifetime (days). */
const THREADS_TOKEN_DAYS = 60;

function ageHrs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / HOUR_MS;
}

/**
 * Build the dashboard snapshot from Firestore. Returns only derived, non-secret
 * fields (counts, post log, token ages/booleans, config) — never raw tokens.
 */
async function buildSnapshot() {
  const [pool, recentPosts, tokens, config] = await Promise.all([
    poolStats(),
    listPosts(20),
    getTokenState(),
    getConfig(),
  ]);

  const msTokenAgeHrs = ageHrs(tokens.msTokenUpdatedAt);
  const threadsTokenAgeHrs = ageHrs(tokens.threadsTokenObtainedAt);
  const threadsDaysToExpiry =
    threadsTokenAgeHrs == null
      ? null
      : THREADS_TOKEN_DAYS - threadsTokenAgeHrs / 24;

  return {
    pool,
    recentPosts,
    tokens: {
      msTokenAgeHrs,
      threadsTokenAgeHrs,
      threadsDaysToExpiry,
      msNeedsReauth: tokens.msNeedsReauth,
      threadsNeedsReauth: tokens.threadsNeedsReauth,
      msConnected: Boolean(tokens.msRefreshToken),
      threadsConnected: Boolean(tokens.threadsToken && tokens.threadsUserId),
    },
    config,
  };
}

/** Cached (≤ once / 60s, shared across all pollers/tabs) variant of the above. */
const getCachedSnapshot = unstable_cache(buildSnapshot, ["status-snapshot"], {
  revalidate: 60,
});

export async function GET(req: NextRequest) {
  try {
    // `?fresh=1` skips the cache so a user's own action reflects immediately;
    // routine polling (no param) is served from the 60s cache.
    const fresh = new URL(req.url).searchParams.has("fresh");
    const snap = fresh ? await buildSnapshot() : await getCachedSnapshot();
    // nextRunIso is clock-derived, not from the DB — compute it fresh either
    // way, honouring the configured publishing weekdays + timezone.
    const nextRunIso = nextScheduledRunIso(
      snap.config.scheduleDays,
      snap.config.timezone,
      new Date()
    );
    return NextResponse.json({ ...snap, nextRunIso });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
