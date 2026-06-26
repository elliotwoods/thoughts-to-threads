// GET /api/thoughts — list all synced thoughts, each augmented with `preview`:
// the exact per-post segment array (year suffix + 500-char splits) produced by
// the shared pure buildPreview(). This is the data source for the live-preview
// UI (requirement 4): preview === reality because publish uses the same code.

import { NextResponse } from "next/server";
import { listThoughts } from "@/lib/firestore";
import { buildPreview } from "@/lib/post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const thoughts = await listThoughts();
    const withPreview = thoughts.map((t) => ({
      ...t,
      preview: buildPreview(t),
    }));
    return NextResponse.json({ thoughts: withPreview });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
