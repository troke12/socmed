import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  hotp,
  totpAt,
  verifyTotp,
  otpauthUri,
  counterFor,
  TOTP_STEP_SEC,
} from "@/lib/auth/totp";

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [1, 2, 3, 4, 5, 10, 20, 32]) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff));
      expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    }
  });

  it("matches RFC 4648 test vectors", () => {
    expect(base32Encode(Buffer.from("f"))).toBe("MY");
    expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
    expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
  });

  it("tolerates the spacing and padding authenticator apps show", () => {
    expect(base32Decode("MZXW 6YTB OI==").toString()).toBe("foobar");
    expect(base32Decode("mzxw6ytboi").toString()).toBe("foobar");
  });

  it("rejects characters outside the alphabet", () => {
    expect(() => base32Decode("MZXW0")).toThrow(/invalid base32/);
  });
});

describe("HOTP — RFC 4226 Appendix D vectors", () => {
  // The published vectors use the ASCII secret "12345678901234567890".
  const secret = Buffer.from("12345678901234567890");
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];

  it("reproduces all ten counters", () => {
    expected.forEach((code, counter) => {
      expect(hotp(secret, counter)).toBe(code);
    });
  });
});

describe("TOTP — RFC 6238 vectors", () => {
  // RFC 6238's SHA-1 vectors, same ASCII secret.
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("matches the published times", () => {
    expect(totpAt(secret, 59)).toBe("287082");
    expect(totpAt(secret, 1111111109)).toBe("081804");
    expect(totpAt(secret, 1111111111)).toBe("050471");
    expect(totpAt(secret, 1234567890)).toBe("005924");
    expect(totpAt(secret, 2000000000)).toBe("279037");
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000;

  it("accepts the current code", () => {
    const result = verifyTotp(secret, totpAt(secret, now), { now });
    expect(result.ok).toBe(true);
    expect(result.step).toBe(counterFor(now));
  });

  it("accepts one step of clock skew either way", () => {
    expect(verifyTotp(secret, totpAt(secret, now - TOTP_STEP_SEC), { now }).ok).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now + TOTP_STEP_SEC), { now }).ok).toBe(true);
  });

  it("rejects a code two steps out", () => {
    expect(verifyTotp(secret, totpAt(secret, now - 2 * TOTP_STEP_SEC), { now }).ok).toBe(false);
    expect(verifyTotp(secret, totpAt(secret, now + 2 * TOTP_STEP_SEC), { now }).ok).toBe(false);
  });

  it("rejects a replayed code", () => {
    const code = totpAt(secret, now);
    const first = verifyTotp(secret, code, { now });
    expect(first.ok).toBe(true);
    // Without step tracking the same code stays usable for ~90s, which is
    // exactly the window someone shoulder-surfing needs.
    expect(verifyTotp(secret, code, { now, lastUsedStep: first.step }).ok).toBe(false);
  });

  it("rejects an older still-in-window code once a newer one was used", () => {
    const used = counterFor(now);
    const previous = totpAt(secret, now - TOTP_STEP_SEC);
    expect(verifyTotp(secret, previous, { now, lastUsedStep: used }).ok).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      expect(verifyTotp(secret, bad, { now }).ok).toBe(false);
    }
  });

  it("rejects a code from a different secret", () => {
    const other = generateTotpSecret();
    expect(verifyTotp(secret, totpAt(other, now), { now }).ok).toBe(false);
  });
});

describe("otpauthUri", () => {
  it("carries the parameters authenticator apps read", () => {
    const uri = otpauthUri("JBSWY3DPEHPK3PXP", "jane", "socmed");
    expect(uri.startsWith("otpauth://totp/socmed%3Ajane?")).toBe(true);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(params.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(params.get("issuer")).toBe("socmed");
    expect(params.get("algorithm")).toBe("SHA1");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });
});

describe("secret generation", () => {
  it("produces a 160-bit secret", () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(seen.size).toBe(50);
  });
});
