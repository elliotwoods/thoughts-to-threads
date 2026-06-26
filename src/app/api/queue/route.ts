// GET  /api/queue       — the normalized "Up Next" queue, each thought augmented
//                          with `preview` (same shape as /api/thoughts).
// PUT  /api/queue        — set an explicit order after a drag-reorder.
//                          Body: { order: string[] }
//
// The queue auto-fills to config.queueSize from a random draw of the unpublished,
// non-skipped pool; reordering and injection are sticky. See src/lib/queue.ts.

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/firestore";
import { normalizeQueue, reorderQueue } from "@/lib/queue";
import { buildPreview } from "@/lib/post";
import type { Thought } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withPreview(queue: Thought[]) {
  return queue.map((t) => ({ ...t, preview: buildPreview(t) }));
}

export async function GET() {
  try {
    const config = await getConfig();
    const queue = await normalizeQueue(config);
    return NextResponse.json({ queue: withPreview(queue) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const order = Array.isArray(body?.order)
      ? body.order.filter((x: unknown): x is string => typeof x === "string")
      : null;
    if (!order) {
      return NextResponse.json(
        { error: "Body must be { order: string[] }" },
        { status: 400 }
      );
    }
    const config = await getConfig();
    const queue = await reorderQueue(config, order);
    return NextResponse.json({ queue: withPreview(queue) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
