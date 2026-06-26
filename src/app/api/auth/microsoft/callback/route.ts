// GET /api/auth/microsoft/callback
// Verify the signed state, exchange the authorization code for a rotating
// refresh token, persist it (encrypted) with a fresh timestamp, clear the
// reauth flag, and redirect back to the connections page.

import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode } from "@/lib/microsoft";
import { verifyState } from "@/lib/state";
import { updateTokenState } from "@/lib/firestore";
import { baseUrlFromRequest, callbackUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);

    const oauthError = searchParams.get("error");
    if (oauthError) {
      const desc = searchParams.get("error_description") || oauthError;
      throw new Error(`Microsoft authorization error: ${desc}`);
    }

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    if (!code) throw new Error("Missing authorization code");
    if (!state) throw new Error("Missing state");

    // Throws if the state is invalid, tampered, or older than ~10 minutes.
    verifyState(state);

    // Must match the redirect URI used in /start; both derive from the request.
    const { refreshToken } = await exchangeCode(code, callbackUrl(req, "microsoft"));

    await updateTokenState({
      msRefreshToken: refreshToken,
      msTokenUpdatedAt: new Date().toISOString(),
      msNeedsReauth: false,
    });

    return NextResponse.redirect(
      new URL("/connections?ms=connected", baseUrlFromRequest(req))
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Microsoft callback failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
