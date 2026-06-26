// POST /api/actions/pause — pause publishing (config.paused = true).

import { NextResponse } from "next/server";
import { updateConfig } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = await updateConfig({ paused: true });
    return NextResponse.json({ paused: config.paused, config });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
