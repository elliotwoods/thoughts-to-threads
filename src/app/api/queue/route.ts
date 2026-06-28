// GET  /api/queue       — the "Up Next" queue, each thought augmented with
//                          `preview` (same shape as /api/thoughts). Reads only
//                          reconcile (drop ineligible); they never top up, so a
//                          manual removal stays reduced. The exception is cold
//                          start (the queue doc has never been written): we
//                          refill once to seed it.
// PUT  /api/queue        — set an explicit order after a drag-reorder.
//                          Body: { order: string[] }
//
// Refilling to config.queueSize happens on the publish cycle (see tick.ts), not
// on reads. See src/lib/queue.ts.

import { NextResponse } from "next/server";
import { getConfig, getQueueState } from "@/lib/firestore";
import { reconcileQueue, refillQueue, reorderQueue } from "@/lib/queue";
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
    const { exists } = await getQueueState();
    // Cold start (doc never written): seed the queue. Otherwise reconcile only —
    // never auto-refill on a read, so removals stick until the next cycle.
    const queue = exists
      ? await reconcileQueue(config)
      : await refillQueue(config);
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
