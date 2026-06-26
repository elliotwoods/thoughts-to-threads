// POST /api/queue/shuffle — redraw the whole "Up Next" queue: a fresh random
// shuffle of the eligible pool, trimmed to config.queueSize.

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/firestore";
import { shuffleQueue } from "@/lib/queue";
import { buildPreview } from "@/lib/post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = await getConfig();
    const queue = await shuffleQueue(config);
    return NextResponse.json({
      queue: queue.map((t) => ({ ...t, preview: buildPreview(t) })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
