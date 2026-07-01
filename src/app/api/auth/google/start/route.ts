import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { signState } from "@/lib/state";
import { googleOAuthConfig, baseUrlFromRequest } from "@/lib/env";

export function GET(req: NextRequest) {
  const { clientId } = googleOAuthConfig();
  const redirectUri = `${baseUrlFromRequest(req)}/api/auth/google/callback`;
  const state = signState({ provider: "google" });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "online");

  return NextResponse.redirect(url.toString());
}
