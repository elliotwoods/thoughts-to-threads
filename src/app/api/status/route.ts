// GET /api/status — dashboard data: pool stats, recent posts, token health,
// current config, and the next scheduled run (next 00:00 UTC). Gated by
// Cloudflare Access (middleware); reads only — never mutates.

import { NextResponse } from "next/server";
import { getConfig, getTokenState, listPosts, poolStats } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Long-lived Threads token lifetime (days). */
const THREADS_TOKEN_DAYS = 60;

function ageHrs(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return (Date.now() - t) / HOUR_MS;
}

/** Next 00:00 UTC strictly after now. */
function nextMidnightUtc(): string {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0)
  );
  return next.toISOString();
}

export async function GET() {
  try {
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

    return NextResponse.json({
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
      nextRunIso: nextMidnightUtc(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
