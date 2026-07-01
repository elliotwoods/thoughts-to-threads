import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Edge-compatible session verification (Web Crypto API, no Node builtins).
// The session cookie is signed with HMAC-SHA256 keyed on ENCRYPTION_KEY
// (UTF-8 bytes of the base64 string, matching src/lib/session.ts).

const SESSION_COOKIE = "__session";

const PUBLIC_PREFIXES = [
  "/api/cron/",
  "/_next/",
  "/api/auth/google/",
  "/api/auth/signout",
  "/login",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/favicon.ico") return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p)
  );
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const encKey = process.env.ENCRYPTION_KEY;
  if (!encKey) return false;
  try {
    const dot = cookieValue.lastIndexOf(".");
    if (dot < 0) return false;
    const payload = cookieValue.slice(0, dot);
    const mac = cookieValue.slice(dot + 1);

    // Key is the UTF-8 bytes of the raw ENCRYPTION_KEY string —
    // matches how Node's createHmac treats a string key in session.ts.
    const keyBytes = new TextEncoder().encode(encKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigBuf = b64urlDecode(mac).buffer as ArrayBuffer;
    const dataBuf = new TextEncoder().encode(payload).buffer as ArrayBuffer;
    const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBuf, dataBuf);
    if (!valid) return false;

    const decoded = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (
      typeof decoded.exp !== "number" ||
      Math.floor(Date.now() / 1000) > decoded.exp
    )
      return false;

    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const cookieValue = req.cookies.get(SESSION_COOKIE)?.value;
  if (await isValidSession(cookieValue)) return NextResponse.next();

  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
