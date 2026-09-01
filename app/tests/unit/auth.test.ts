import { describe, it, expect, beforeAll } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createSessionCookie,
  parseSessionCookie,
  createPendingTotpCookie,
  parsePendingTotpCookie,
} from "@/lib/auth/session";

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

describe("pending two-factor token", () => {
  it("round-trips through its own parser", () => {
    const pending = parsePendingTotpCookie(createPendingTotpCookie(7));
    expect(pending?.uid).toBe(7);
  });

  // The whole point of the domain separation. A token that only proves "the
  // password was right" must never be usable as a full session, and vice versa.
  it("cannot be replayed as a session cookie", () => {
    expect(parseSessionCookie(createPendingTotpCookie(7))).toBeNull();
  });

  it("does not accept a real session cookie", () => {
    expect(parsePendingTotpCookie(createSessionCookie(7))).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = createPendingTotpCookie(7);
    const [body] = token.split(".");
    expect(parsePendingTotpCookie(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects a body swapped onto a valid signature", () => {
    const [, sig] = createPendingTotpCookie(7).split(".");
    const forged = Buffer.from(JSON.stringify({ uid: 1, exp: 9_999_999_999 })).toString("base64url");
    expect(parsePendingTotpCookie(`${forged}.${sig}`)).toBeNull();
  });
});
