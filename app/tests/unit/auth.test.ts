import { describe, it, expect, beforeAll } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionCookie, parseSessionCookie } from "@/lib/auth/session";

beforeAll(() => {
  process.env.SOCMED_COOKIE_SECRET = "test-secret-please-make-this-long-enough-32+chars";
});

describe("password", () => {
  it("hashes and verifies a password", async () => {
    const h = await hashPassword("hunter2-correct");
    expect(h).not.toBe("hunter2-correct");
    expect(await verifyPassword("hunter2-correct", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("session cookie", () => {
  it("signs and parses a valid cookie", () => {
    const cookie = createSessionCookie(42);
    const parsed = parseSessionCookie(cookie);
    expect(parsed?.uid).toBe(42);
  });

  it("rejects a tampered cookie", () => {
    const cookie = createSessionCookie(1);
    const tampered = cookie.slice(0, -2) + "AA";
    expect(parseSessionCookie(tampered)).toBeNull();
  });

  it("rejects an empty cookie", () => {
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie("")).toBeNull();
    expect(parseSessionCookie("no-dot-here")).toBeNull();
  });
});
