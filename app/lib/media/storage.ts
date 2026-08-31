import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const UPLOADS_DIR = resolve(process.env.SOCMED_UPLOADS_DIR ?? "./data/uploads");

export async function ensureUploadsDir(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

export function uploadsDir(): string {
  return UPLOADS_DIR;
}

export interface StoredFile {
  path: string; // relative to UPLOADS_DIR, e.g. "ab/cd1234.jpg"
  absolutePath: string;
  sha256: string;
  sizeBytes: number;
}

export async function storeBuffer(buf: Buffer, ext: string, _mime: string): Promise<StoredFile> {
  await ensureUploadsDir();
  const sha256 = createHash("sha256").update(buf).digest("hex");
  // Shard by first 2 chars to avoid one huge dir
  const rel = `${sha256.slice(0, 2)}/${sha256}${ext.startsWith(".") ? ext : "." + ext}`;
  const abs = join(UPLOADS_DIR, rel);
  await mkdir(join(UPLOADS_DIR, sha256.slice(0, 2)), { recursive: true });
  await writeFile(abs, buf);
  return { path: rel, absolutePath: abs, sha256, sizeBytes: buf.length };
}
