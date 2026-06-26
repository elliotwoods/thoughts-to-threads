// GET /api/auth/threads/callback
// Verify the signed state, exchange the authorization code for a long-lived
// (60d) token + user id, persist them (token encrypted) with a fresh
// timestamp, clear the reauth flag, and redirect back to the connections page.

import { NextResponse, type NextRequest } from "next/server";
import { exchangeCodeForLongLived } from "@/lib/threads";
import { verifyState } from "@/lib/state";
import { updateTokenState } from "@/lib/firestore";
import { appBaseUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);

    const oauthError = searchParams.get("error");
    if (oauthError) {
      const desc =
        searchParams.get("error_description") ||
        searchParams.get("error_reason") ||
        oauthError;
      throw new Error(`Threads authorization error: ${desc}`);
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code) throw new Error("Missing authorization code");
    if (!state) throw new Error("Missing state");

    // Throws if the state is invalid, tampered, or older than ~10 minutes.
    verifyState(state);

    const { token, userId } = await exchangeCodeForLongLived(code);

    await updateTokenState({
      threadsToken: token,
      threadsTokenObtainedAt: new Date().toISOString(),
      threadsUserId: userId,
      threadsNeedsReauth: false,
    });

    return NextResponse.redirect(
      new URL("/connections?threads=connected", appBaseUrl())
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Threads callback failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
