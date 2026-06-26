// POST /api/thoughts/[id]/skip — toggle the `skip` flag for a thought
// (excludes/includes it in selection). Returns the new value.

import { NextResponse } from "next/server";
import { getThought, updateThought } from "@/lib/firestore";

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
    const skip = !thought.skip;
    await updateThought(id, { skip });
    return NextResponse.json({ id, skip });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
