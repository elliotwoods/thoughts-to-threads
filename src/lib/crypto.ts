// AES-256-GCM encrypt/decrypt (SPECS.md section 6). Format: ivB64:tagB64:ctB64.
// The ENCRYPTION_KEY is read lazily (never at module top level).

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { encryptionKey } from "./env";

function key(): Buffer {
  const k = Buffer.from(encryptionKey(), "base64"); // 32 bytes
  if (k.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be base64-encoded 32 bytes");
  }
  return k;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [
    iv.toString("base64"),
    c.getAuthTag().toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decrypt(blob: string): string {
  const [iv, tag, ct] = blob.split(":").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
