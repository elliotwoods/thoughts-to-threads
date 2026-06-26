// POST /api/actions/resume — resume publishing (config.paused = false).

import { NextResponse } from "next/server";
import { updateConfig } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = await updateConfig({ paused: false });
    return NextResponse.json({ paused: config.paused, config });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
