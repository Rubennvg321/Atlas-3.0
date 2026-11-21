import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Versleuteling van tokens en API-sleutels in de database (AES-256-GCM).
 * De sleutel wordt afgeleid van ENCRYPTION_KEY, of anders van AUTH_SECRET.
 * Let op: wie AUTH_SECRET wijzigt, moet de koppelingen opnieuw maken.
 */
function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) throw new Error("ENCRYPTION_KEY of AUTH_SECRET ontbreekt");
  return createHash("sha256").update(`atlas-tokens:${secret}`).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1") throw new Error("Onbekend versleutelingsformaat");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export function encryptJson(v: unknown) {
  return encrypt(JSON.stringify(v));
}
export function decryptJson<T>(s: string): T {
  return JSON.parse(decrypt(s)) as T;
}
