// POST /api/queue/random — append one random eligible thought that isn't already
// queued to the "Up Next" list. Safe no-op when none remain. Does not top up to
// queueSize (that only happens on the publish cycle).

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/firestore";
import { addRandom } from "@/lib/queue";
import { buildPreview } from "@/lib/post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = await getConfig();
    const queue = await addRandom(config);
    return NextResponse.json({
      queue: queue.map((t) => ({ ...t, preview: buildPreview(t) })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
