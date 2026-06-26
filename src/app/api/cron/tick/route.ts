import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { cronSecret } from "@/lib/env";
import { runTick } from "@/lib/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Constant-time string compare (guards length first to avoid throwing). */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    if (!auth || !safeEqual(auth, `Bearer ${cronSecret()}`)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const summary = await runTick({});
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
