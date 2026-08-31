import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getMasterKey(): Buffer {
  const b64 = process.env.SOCMED_MASTER_KEY;
  if (!b64) throw new Error("SOCMED_MASTER_KEY missing");
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 32) throw new Error("SOCMED_MASTER_KEY must decode to >=32 bytes");
  return buf;
}

function deriveKey(accountId: number): Buffer {
  const master = getMasterKey();
  // HKDF-SHA256, 32 bytes, info binds the key to the account
  const derived = hkdfSync("sha256", master, Buffer.from(String(accountId)), Buffer.from("socmed-account"), 32);
  return Buffer.from(derived);
}

export interface Ciphertext {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function encryptJson(accountId: number, payload: unknown): Ciphertext {
  const key = deriveKey(accountId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) throw new Error("unexpected gcm tag length");
  return { iv, tag, ciphertext: enc };
}

export function decryptJson<T = unknown>(accountId: number, ct: Ciphertext): T {
  const key = deriveKey(accountId);
  const decipher = createDecipheriv(ALGO, key, ct.iv);
  decipher.setAuthTag(ct.tag);
  const plain = Buffer.concat([decipher.update(ct.ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}

// helpers to pack/unpack for SQLite BLOB columns
export function pack(ct: Ciphertext): { encryptedCreds: Buffer; credsIv: Buffer; credsTag: Buffer } {
  return { encryptedCreds: ct.ciphertext, credsIv: ct.iv, credsTag: ct.tag };
}

export function unpack(encryptedCreds: Buffer, credsIv: Buffer, credsTag: Buffer): Ciphertext {
  return { iv: credsIv, tag: credsTag, ciphertext: encryptedCreds };
}
