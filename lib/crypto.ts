// AES-256-GCM encryption for secrets stored at rest in SQLite (e.g. Google refresh tokens).
// Key is derived from NEXTAUTH_SECRET so there is no extra secret to manage.
// Server-only. Ciphertext is never sent to the client.
import crypto from "node:crypto";
import { requireSecret } from "@/lib/secrets";

function key(): Buffer {
  // 32-byte key derived from NEXTAUTH_SECRET
  return crypto.createHash("sha256").update(requireSecret("NEXTAUTH_SECRET")).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(blob: string): string {
  const [ivB64, tagB64, dataB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("bad ciphertext");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
