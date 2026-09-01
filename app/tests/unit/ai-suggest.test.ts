import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

// Hoisted so the route module is loaded once for the file. Swapping an
// implementation variable per test avoids vi.resetModules(), which re-imported
// the whole route graph on every test and blew the timeout under load.
const suggestState: { impl: () => Promise<unknown> } = {
  impl: async () => ({ captions: ["ok"], hashtags: [], notes: "" }),
};

vi.mock("@/lib/auth/require", () => ({
  requireSession: async () => ({ id: 7, username: "ed", role: "editor" }),
  requireRole: async () => ({ id: 7, username: "ed", role: "editor" }),
  trySession: async () => ({ id: 7, username: "ed", role: "editor" }),
}));
vi.mock("@db/migrate", () => ({ runMigrations: async () => ({ applied: [] }) }));
vi.mock("@/lib/ai/suggest", async (orig) => {
  const mod = await orig<typeof import("@/lib/ai/suggest")>();
  return { ...mod, suggest: () => suggestState.impl() };
});

import { normalise, AiNotConfiguredError, AiRefusedError } from "@/lib/ai/suggest";
import { aiConfig, aiEnabled, DEFAULT_MODEL } from "@/lib/ai/config";
import type { PlatformId } from "@/lib/platform-meta";
import { getContentRules } from "@platforms/content-rules";

const saved = { ...process.env };
const AI_KEYS = ["SOCMED_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "SOCMED_AI_MODEL"];

beforeEach(() => {
  for (const k of AI_KEYS) delete process.env[k];
});
afterAll(() => { Object.assign(process.env, saved); });

describe("config", () => {
  it("is off with no key", () => {
    expect(aiEnabled()).toBe(false);
    expect(aiConfig().apiKey).toBeNull();
  });

  it("prefers the SOCMED-prefixed key over the generic one", () => {
    process.env.ANTHROPIC_API_KEY = "generic";
    process.env.SOCMED_ANTHROPIC_API_KEY = "specific";
    // Lets this install's key be separable from anything else on the host.
    expect(aiConfig().apiKey).toBe("specific");
  });

  it("falls back to the SDK's conventional variable", () => {
    process.env.ANTHROPIC_API_KEY = "generic";
    expect(aiConfig().apiKey).toBe("generic");
    expect(aiEnabled()).toBe(true);
  });

  it("defaults to Opus 5 and allows an override", () => {
    expect(aiConfig().model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
    process.env.SOCMED_AI_MODEL = "claude-sonnet-5";
    expect(aiConfig().model).toBe("claude-sonnet-5");
  });

  it("treats a whitespace-only key as unset", () => {
    process.env.SOCMED_ANTHROPIC_API_KEY = "   ";
    expect(aiEnabled()).toBe(false);
  });
});

describe("normalise", () => {
  const input = { caption: "hi", platforms: [] as PlatformId[], tone: "keep" as const };

  it("strips leading hashes and lowercases", () => {
    const out = normalise({ captions: ["a"], hashtags: ["#Growth", "##Marketing", "Sales"], notes: "" }, input);
    expect(out.hashtags).toEqual(["growth", "marketing", "sales"]);
  });

  it("removes duplicates that differ only by case or hash", () => {
    const out = normalise({ captions: ["a"], hashtags: ["#growth", "Growth", "GROWTH"], notes: "" }, input);
    expect(out.hashtags).toEqual(["growth"]);
  });

  it("drops empty tags", () => {
    const out = normalise({ captions: ["a"], hashtags: ["#", "  ", "ok"], notes: "" }, input);
    expect(out.hashtags).toEqual(["ok"]);
  });

  it("trims captions and drops blank ones", () => {
    const out = normalise({ captions: ["  spaced  ", "   ", "second"], hashtags: [], notes: " note " }, input);
    expect(out.captions).toEqual(["spaced", "second"]);
    expect(out.notes).toBe("note");
  });

  it("drops a caption that exceeds the strictest selected platform", () => {
    // Bluesky is the tight one; LinkedIn would happily take the long caption.
    const platforms: PlatformId[] = ["bluesky", "linkedin"];
    const limit = getContentRules("bluesky").textLimit!;
    const tooLong = "x".repeat(limit + 50);
    const out = normalise({ captions: [tooLong, "short one"], hashtags: [], notes: "" }, { ...input, platforms });
    // Offering something the platform will reject is worse than offering less.
    expect(out.captions).toEqual(["short one"]);
  });

  it("keeps the over-limit captions when filtering would leave nothing", () => {
    const platforms: PlatformId[] = ["bluesky"];
    const limit = getContentRules("bluesky").textLimit!;
    const tooLong = "x".repeat(limit + 50);
    const out = normalise({ captions: [tooLong], hashtags: [], notes: "" }, { ...input, platforms });
    // Better the author sees it and judges than sees an empty panel.
    expect(out.captions).toHaveLength(1);
  });

  it("does not filter by length when no platform is selected", () => {
    const out = normalise({ captions: ["x".repeat(5000)], hashtags: [], notes: "" }, input);
    expect(out.captions).toHaveLength(1);
  });
});

describe("POST /api/ai/suggest", () => {
  async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const { POST } = await import("@/app/api/ai/suggest/route");
    const res = await POST(
      new Request("http://localhost/api/ai/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  // Warm the route's module graph outside any test's timeout. The first import
  // pulls zod, the platform content rules and the auth chain; under full-suite
  // contention that alone outlasted a single test's 5s budget, failing whichever
  // test happened to run first for reasons unrelated to it.
  beforeAll(async () => {
    await import("@/app/api/ai/suggest/route");
  }, 120_000);

  beforeEach(() => {
    suggestState.impl = async () => ({ captions: ["ok"], hashtags: [], notes: "" });
  });

  it("refuses an empty request before spending a model call", async () => {
    let called = false;
    suggestState.impl = async () => { called = true; return { captions: ["x"], hashtags: [], notes: "" }; };
    const { status, json } = await post({ caption: "   ", platforms: [] });
    expect(status).toBe(400);
    expect(json.error).toMatch(/nothing to work from/);
    // The point is that it never reached the model.
    expect(called).toBe(false);
  });

  it("reports 501 when no key is configured", async () => {
    suggestState.impl = async () => { throw new AiNotConfiguredError(); };
    const { status } = await post({ caption: "hello", platforms: [] });
    // Not a 500: the server is fine, the feature is simply not set up.
    expect(status).toBe(501);
  });

  it("reports 422 on a model refusal", async () => {
    suggestState.impl = async () => { throw new AiRefusedError("cyber"); };
    const { status, json } = await post({ caption: "hello", platforms: [] });
    // Not retryable and not the server's fault — the author writes it themselves.
    expect(status).toBe(422);
    expect(json.error).toContain("cyber");
  });

  it("reports 502 on an unexpected failure", async () => {
    suggestState.impl = async () => { throw new Error("upstream exploded"); };
    const { status, json } = await post({ caption: "hello", platforms: [] });
    expect(status).toBe(502);
    expect(json.error).toContain("upstream exploded");
  });

  it("passes a suggestion through on success", async () => {
    suggestState.impl = async () => ({ captions: ["nice"], hashtags: ["growth"], notes: "tightened it" });
    const { status, json } = await post({ caption: "hello", platforms: ["x"] });
    expect(status).toBe(200);
    expect(json).toMatchObject({ captions: ["nice"], hashtags: ["growth"] });
  });

  it("rejects an unknown platform", async () => {
    const { status } = await post({ caption: "hello", platforms: ["myspace"] });
    expect(status).toBe(400);
  });

  it("rate limits repeated calls", async () => {
    let limited = false;
    for (let i = 0; i < 30; i++) {
      const { status } = await post({ caption: "hello", platforms: [] });
      if (status === 429) { limited = true; break; }
    }
    // Each call costs real money; a stuck client must not loop indefinitely.
    expect(limited).toBe(true);
  });
});
