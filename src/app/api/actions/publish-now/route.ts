// POST /api/actions/publish-now — run one publish cycle immediately. Uses the
// manual path: publishes to Threads without requiring a healthy Microsoft
// connection (no sync; MS only touched for optional write-back) and runs even
// when paused, since it is an explicit user action.

import { NextResponse } from "next/server";
import { runManualPublish } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const summary = await runManualPublish();
    return NextResponse.json(summary);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
