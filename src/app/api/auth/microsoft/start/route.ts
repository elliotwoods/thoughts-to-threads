// GET /api/auth/microsoft/start
// Redirect the browser to the Microsoft consent screen with a signed state.

import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/microsoft";
import { signState } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const url = authorizeUrl(signState({ provider: "microsoft" }));
    return NextResponse.redirect(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start Microsoft auth";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
