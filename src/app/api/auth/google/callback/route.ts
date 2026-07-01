import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyState } from "@/lib/state";
import { googleOAuthConfig, allowedEmails, baseUrlFromRequest } from "@/lib/env";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");

  const base = baseUrlFromRequest(req);
  const loginUrl = `${base}/login`;

  if (oauthError) {
    return NextResponse.redirect(`${loginUrl}?error=oauth_error`);
  }

  try {
    if (!state) throw new Error("missing state");
    verifyState(state);
  } catch {
    return NextResponse.redirect(`${loginUrl}?error=invalid_state`);
  }

  if (!code) {
    return NextResponse.redirect(`${loginUrl}?error=missing_code`);
  }

  const { clientId, clientSecret } = googleOAuthConfig();
  const redirectUri = `${base}/api/auth/google/callback`;

  let email: string;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const tokens = await tokenRes.json();

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!userRes.ok) throw new Error(`userinfo ${userRes.status}`);
    const user = await userRes.json();
    email = (user.email as string | undefined)?.toLowerCase() ?? "";
    if (!email) throw new Error("no email");
  } catch {
    return NextResponse.redirect(`${loginUrl}?error=auth_failed`);
  }

  if (!allowedEmails().includes(email)) {
    return NextResponse.redirect(`${loginUrl}?error=unauthorized`);
  }

  const res = NextResponse.redirect(`${base}/`);
  res.cookies.set(SESSION_COOKIE, signSession(email), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SEC,
    path: "/",
  });
  return res;
}
