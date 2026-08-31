// Minimal in-memory rate limiter (single-process web app; sliding window).

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 5000;

function prune(): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [k, b] of buckets) {
    if (b.timestamps.length === 0) buckets.delete(k);
  }
}

/**
 * Returns true when the key is allowed, false when the rate limit is
 * exceeded for the window.
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);
  if (bucket.timestamps.length >= limit) {
    prune();
    return false;
  }
  bucket.timestamps.push(now);
  prune();
  return true;
}

// Login-specific helpers: 5 attempts per 15 minutes per IP.
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function loginAllowed(ip: string): boolean {
  return rateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
}
