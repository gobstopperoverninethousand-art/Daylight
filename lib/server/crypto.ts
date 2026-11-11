import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./auth";
function key() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY || "";
  const b = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (b.length !== 32)
    throw new HttpError(
      "TOKEN_ENCRYPTION_KEY must contain 32 random bytes encoded as hex or base64.",
      503,
    );
  return b;
}
export function seal(value: unknown): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function unseal<T>(raw: string): T {
  const b = Buffer.from(raw, "base64url"),
    cipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(),
  );
}
