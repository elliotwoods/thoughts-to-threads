// POST   /api/queue/[id] — inject a thought into the queue.
//                          Body: { position: "next" | "last" | <0-based index> }
//                          (default "next"). A numeric index is used by drag-in
//                          to drop at a specific slot. Clears `skip` so the
//                          thought is eligible.
// DELETE /api/queue/[id] — remove a thought from the queue (stays in the pool).

import { NextResponse } from "next/server";
import { getConfig, getThought, updateThought } from "@/lib/firestore";
import { addToQueue, removeFromQueue, type QueuePosition } from "@/lib/queue";
import { buildPreview } from "@/lib/post";
import type { Thought } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withPreview(queue: Thought[]) {
  return queue.map((t) => ({ ...t, preview: buildPreview(t) }));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const raw = body?.position;
    const position: QueuePosition =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.floor(raw)
        : raw === "last"
          ? "last"
          : "next";

    const thought = await getThought(id);
    if (!thought) {
      return NextResponse.json({ error: "Thought not found" }, { status: 404 });
    }
    // Queuing implies wanting it published, so clear skip (mirrors old pin behaviour).
    if (thought.skip) await updateThought(id, { skip: false });

    const config = await getConfig();
    const queue = await addToQueue(config, id, position);
    return NextResponse.json({ queue: withPreview(queue) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const config = await getConfig();
    const queue = await removeFromQueue(config, id);
    return NextResponse.json({ queue: withPreview(queue) });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
