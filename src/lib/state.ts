// Signed OAuth state for CSRF protection. Encoded as base64url(JSON) of
// { payload, ts } joined with an HMAC over that body. Verified within ~10 min.

import { createHmac, timingSafeEqual } from "crypto";
import { optionalEnv, encryptionKey } from "./env";

const MAX_AGE_MS = 10 * 60 * 1000; // ~10 minutes

function secret(): Buffer {
  // Prefer CRON_SECRET; fall back to an ENCRYPTION_KEY-derived secret.
  const cron = optionalEnv("CRON_SECRET");
  if (cron) return Buffer.from(cron, "utf8");
  return createHmac("sha256", encryptionKey()).update("oauth-state").digest();
}

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

function sign(body: string): string {
  return b64url(createHmac("sha256", secret()).update(body).digest());
}

export function signState(payload: Record<string, unknown> = {}): string {
  const body = b64url(Buffer.from(JSON.stringify({ payload, ts: Date.now() }), "utf8"));
  const mac = sign(body);
  return `${body}.${mac}`;
}

export function verifyState(state: string): Record<string, unknown> {
  if (!state || typeof state !== "string") {
    throw new Error("Invalid state");
  }
  const [body, mac] = state.split(".");
  if (!body || !mac) {
    throw new Error("Malformed state");
  }
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("State signature mismatch");
  }
  let decoded: { payload: Record<string, unknown>; ts: number };
  try {
    decoded = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    throw new Error("State decode failed");
  }
  if (typeof decoded.ts !== "number" || Date.now() - decoded.ts > MAX_AGE_MS) {
    throw new Error("State expired");
  }
  return decoded.payload ?? {};
}
