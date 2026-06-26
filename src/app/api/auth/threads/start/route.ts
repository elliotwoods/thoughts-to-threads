// GET /api/auth/threads/start
// Redirect the browser to the Threads authorize screen with a signed state.

import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl } from "@/lib/threads";
import { signState } from "@/lib/state";
import { callbackUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const redirectUri = callbackUrl(req, "threads");
    const url = authorizeUrl(signState({ provider: "threads" }), redirectUri);
    return NextResponse.redirect(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start Threads auth";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
