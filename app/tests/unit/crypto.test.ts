import { describe, it, expect, beforeAll } from "vitest";
import { decryptJson, encryptJson, pack, unpack } from "@/lib/platforms/crypto";

beforeAll(() => {
  process.env.SOCMED_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("credential crypto", () => {
  it("round-trips JSON payload", () => {
    const payload = { accessToken: "abc", refreshToken: "xyz", nested: { a: 1 } };
    const ct = encryptJson(123, payload);
    const back = decryptJson<typeof payload>(123, ct);
    expect(back).toEqual(payload);
  });

  it("derives different keys per accountId", () => {
    const ct1 = encryptJson(1, { accessToken: "same" });
    const ct2 = encryptJson(2, { accessToken: "same" });
    // Same plaintext, different keys → different ciphertexts
    expect(ct1.ciphertext.equals(ct2.ciphertext)).toBe(false);
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptJson(5, { accessToken: "secret" });
    const tampered = Buffer.from(ct.ciphertext);
    tampered[0]! ^= 0xff;
    expect(() =>
      decryptJson(5, { iv: ct.iv, tag: ct.tag, ciphertext: tampered }),
    ).toThrow();
  });

  it("rejects tampered tag", () => {
    const ct = encryptJson(5, { accessToken: "secret" });
    const badTag = Buffer.from(ct.tag);
    badTag[0]! ^= 0x01;
    expect(() =>
      decryptJson(5, { iv: ct.iv, tag: badTag, ciphertext: ct.ciphertext }),
    ).toThrow();
  });

  it("pack/unpack round-trips blob fields", () => {
    const ct = encryptJson(9, { accessToken: "x" });
    const packed = pack(ct);
    const back = unpack(packed.encryptedCreds, packed.credsIv, packed.credsTag);
    expect(decryptJson(9, back)).toEqual({ accessToken: "x" });
  });
});
