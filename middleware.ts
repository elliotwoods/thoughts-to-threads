import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware — a single hard password gate (HTTP Basic Auth) for the
 * dashboard and its API.
 *
 * - /api/cron/* is protected by CRON_SECRET in its own handler and is hit by
 *   Vercel Cron (which sends a Bearer token, not Basic auth), so it passes
 *   through here unconditionally.
 * - Next internals / favicon pass through unconditionally.
 * - Everything else requires `Authorization: Basic` whose password matches
 *   DASHBOARD_PASSWORD. The username is ignored — only the password is checked.
 * - If DASHBOARD_PASSWORD is unset/empty, stay permissive so local dev works.
 */
const REALM = "Thoughts to Threads";

/** Length-independent constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Extract the password from an `Authorization: Basic base64(user:pass)` header. */
function basicAuthPassword(header: string | null): string | null {
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice("Basic ".length).trim());
    const sep = decoded.indexOf(":");
    return sep === -1 ? decoded : decoded.slice(sep + 1);
  } catch {
    return null;
  }
}

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

  const password = process.env.DASHBOARD_PASSWORD;

  // Gate is opt-in: no password configured → stay permissive (local dev).
  if (!password) return NextResponse.next();

  const supplied = basicAuthPassword(req.headers.get("authorization"));
  if (supplied !== null && safeEqual(supplied, password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

export const config = {
  // Run on everything except Next internals and static files with an extension.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
