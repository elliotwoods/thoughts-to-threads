// Signed HTTP-only session cookie. Format: base64url(JSON({email,exp})).HMAC
// HMAC-SHA256 keyed on ENCRYPTION_KEY (same key used elsewhere for crypto).

import { createHmac, timingSafeEqual } from "crypto";
import { encryptionKey } from "./env";

export const SESSION_COOKIE = "__session";
const MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(payload: string): string {
  return b64url(createHmac("sha256", encryptionKey()).update(payload).digest());
}

export function signSession(email: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = b64url(Buffer.from(JSON.stringify({ email, exp }), "utf8"));
  return `${payload}.${hmac(payload)}`;
}

export function verifySession(value: string | undefined): { email: string } | null {
  if (!value) return null;
  try {
    const dot = value.lastIndexOf(".");
    if (dot < 0) return null;
    const payload = value.slice(0, dot);
    const mac = value.slice(dot + 1);
    const expected = hmac(payload);
    const a = Buffer.from(mac, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const decoded = JSON.parse(fromB64url(payload).toString("utf8"));
    if (typeof decoded.exp !== "number" || Math.floor(Date.now() / 1000) > decoded.exp) return null;
    if (typeof decoded.email !== "string") return null;
    return { email: decoded.email };
  } catch {
    return null;
  }
}

export const SESSION_MAX_AGE_SEC = MAX_AGE_SEC;
