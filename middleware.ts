import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware.
 *
 * - /api/cron/* is protected by CRON_SECRET in its own handler, so it passes
 *   through here unconditionally (Vercel Cron cannot send Cf-Access headers).
 * - Next static assets pass through unconditionally.
 * - Everything else is assumed to sit behind Cloudflare Access. As a lightweight
 *   defence-in-depth check, if CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN are
 *   configured we require the Cf-Access-Jwt-Assertion header to be present.
 *   (Full JWT signature verification against the team's JWKS is intentionally
 *   left out of the edge runtime here; enable it below if desired.)
 * - If Cloudflare Access is not configured, stay permissive so local dev works.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always-allow paths.
  if (
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const aud = process.env.CF_ACCESS_AUD;
  const teamDomain = process.env.CF_ACCESS_TEAM_DOMAIN;

  // Only enforce when Cloudflare Access is configured.
  if (aud && teamDomain) {
    const assertion = req.headers.get("Cf-Access-Jwt-Assertion");
    if (!assertion) {
      return new NextResponse(
        JSON.stringify({ error: "Cloudflare Access required" }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    // NOTE: For full verification, fetch the team JWKS from
    // `https://${teamDomain}/cdn-cgi/access/certs`, verify the JWT signature,
    // and assert the `aud` claim contains CF_ACCESS_AUD. Omitted here to keep
    // the edge runtime dependency-free; presence check above is the gate.
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static files with an extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
