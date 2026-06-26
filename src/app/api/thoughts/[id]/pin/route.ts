// POST /api/thoughts/[id]/pin — toggle the `pin` flag (force this thought next).
// Pinning is exclusive: turning a pin on clears the pin on every other thought.

import { NextResponse } from "next/server";
import { getThought, listThoughts, updateThought } from "@/lib/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const thought = await getThought(id);
    if (!thought) {
      return NextResponse.json({ error: "Thought not found" }, { status: 404 });
    }
    const pin = !thought.pin;

    if (pin) {
      // Exclusive pin: clear any other pinned thought first.
      const others = await listThoughts();
      await Promise.all(
        others
          .filter((t) => t.id !== id && t.pin)
          .map((t) => updateThought(t.id, { pin: false }))
      );
    }

    // Pinning forces this thought next; selection ignores skipped thoughts, so
    // clear skip when pinning on to avoid a pinned-but-excluded contradiction.
    await updateThought(id, pin ? { pin, skip: false } : { pin });
    return NextResponse.json({ id, pin });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
