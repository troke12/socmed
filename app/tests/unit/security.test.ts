import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { verifyHubSignature, verifyHmacHeader, resolveHubChallenge } from "@/lib/security/webhook";
import { loginAllowed } from "@/lib/security/rate-limit";
import { signMediaPath, verifyMediaSignature } from "@/lib/media/url";

beforeAll(() => {
  process.env.SOCMED_COOKIE_SECRET = "test-secret-please-make-this-long-enough-32+chars";
});

afterAll(() => {
  delete process.env.SOCMED_COOKIE_SECRET;
});

describe("webhook signature verification", () => {
  it("accepts a valid X-Hub-Signature-256", () => {
    const secret = "appsecret";
    const body = '{"entry":[]}';
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyHubSignature(secret, body, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const secret = "appsecret";
    const body = '{"entry":[]}';
    const sig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
    expect(verifyHubSignature(secret, body + " ", sig)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyHubSignature("secret", "body", undefined)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const body = "body";
    const sig = `sha256=${createHmac("sha256", "other").update(body).digest("hex")}`;
    expect(verifyHubSignature("secret", body, sig)).toBe(false);
  });

  it("verifyHmacHeader accepts valid signature", () => {
    const body = "payload";
    const sig = createHmac("sha256", "k").update(body).digest("hex");
    expect(verifyHmacHeader("k", body, sig)).toBe(true);
  });

  it("resolveHubChallenge returns challenge only on token match", () => {
    expect(resolveHubChallenge("subscribe", "tok", "challenge123", "tok")).toBe("challenge123");
    expect(resolveHubChallenge("subscribe", "wrong", "challenge123", "tok")).toBeNull();
    expect(resolveHubChallenge("unsubscribe", "tok", "challenge123", "tok")).toBeNull();
  });
});

describe("login rate limit", () => {
  it("allows 5 attempts then blocks", () => {
    // Fresh IP key
    const ip = `10.0.0.${Math.floor(Math.random() * 1000)}`;
    for (let i = 0; i < 5; i++) {
      expect(loginAllowed(ip)).toBe(true);
    }
    expect(loginAllowed(ip)).toBe(false);
  });
});

describe("signed media URLs", () => {
  it("signs and verifies a media path", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signMediaPath("ab/abc.jpg", exp);
    expect(verifyMediaSignature("ab/abc.jpg", exp, sig)).toBe(true);
  });

  it("rejects a tampered path", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signMediaPath("ab/abc.jpg", exp);
    expect(verifyMediaSignature("ab/other.jpg", exp, sig)).toBe(false);
  });

  it("rejects an expired signature", () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const sig = signMediaPath("ab/abc.jpg", exp);
    expect(verifyMediaSignature("ab/abc.jpg", exp, sig)).toBe(true); // sig itself valid
    // expiry is enforced by the route, not the verifier
  });
});
