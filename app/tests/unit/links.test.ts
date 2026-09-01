import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUtm, utmSourceFor, utmDefaults } from "@/lib/links/utm";
import { generateSlug } from "@/lib/links/shorten";

describe("applyUtm", () => {
  it("appends the standard parameters", () => {
    const out = new URL(applyUtm("https://example.com/post", { source: "twitter", medium: "social", campaign: "launch" }));
    expect(out.searchParams.get("utm_source")).toBe("twitter");
    expect(out.searchParams.get("utm_medium")).toBe("social");
    expect(out.searchParams.get("utm_campaign")).toBe("launch");
  });

  it("defaults medium to social", () => {
    const out = new URL(applyUtm("https://example.com/", { source: "linkedin" }));
    expect(out.searchParams.get("utm_medium")).toBe("social");
  });

  it("omits empty and null values rather than writing blanks", () => {
    const out = new URL(applyUtm("https://example.com/", { source: "x", campaign: null, content: "" }));
    // utm_campaign= with no value is worse than no parameter at all.
    expect(out.searchParams.has("utm_campaign")).toBe(false);
    expect(out.searchParams.has("utm_content")).toBe(false);
  });

  it("never overwrites a parameter the author set", () => {
    const out = new URL(
      applyUtm("https://example.com/?utm_campaign=spring-sale&utm_source=newsletter", {
        source: "twitter",
        campaign: "launch",
      }),
    );
    // Someone who typed these meant them; clobbering breaks attribution they
    // deliberately set up.
    expect(out.searchParams.get("utm_campaign")).toBe("spring-sale");
    expect(out.searchParams.get("utm_source")).toBe("newsletter");
    expect(out.searchParams.get("utm_medium")).toBe("social");
  });

  it("preserves existing query and fragment", () => {
    const out = applyUtm("https://example.com/p?ref=abc#section", { source: "reddit" });
    const u = new URL(out);
    expect(u.searchParams.get("ref")).toBe("abc");
    expect(u.hash).toBe("#section");
  });

  it("returns non-http input untouched instead of throwing", () => {
    // A bad link must not take a publish down with it.
    expect(applyUtm("not a url", { source: "x" })).toBe("not a url");
    expect(applyUtm("mailto:a@b.c", { source: "x" })).toBe("mailto:a@b.c");
    expect(applyUtm("javascript:alert(1)", { source: "x" })).toBe("javascript:alert(1)");
  });
});

describe("utmSourceFor", () => {
  it("maps x to twitter", () => {
    // "x" alone is meaningless in a GA report.
    expect(utmSourceFor("x")).toBe("twitter");
  });

  it("passes through the rest", () => {
    expect(utmSourceFor("linkedin")).toBe("linkedin");
    expect(utmSourceFor("instagram")).toBe("instagram");
  });
});

describe("utmDefaults", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.SOCMED_UTM_ENABLED;
    delete process.env.SOCMED_UTM_MEDIUM;
    delete process.env.SOCMED_UTM_CAMPAIGN;
  });
  afterAll(() => { Object.assign(process.env, saved); });

  it("is on by default", () => {
    expect(utmDefaults().enabled).toBe(true);
    expect(utmDefaults().medium).toBe("social");
  });

  it("can be switched off", () => {
    process.env.SOCMED_UTM_ENABLED = "false";
    expect(utmDefaults().enabled).toBe(false);
  });

  it("takes an override medium and campaign", () => {
    process.env.SOCMED_UTM_MEDIUM = "paid-social";
    process.env.SOCMED_UTM_CAMPAIGN = "always-on";
    expect(utmDefaults()).toMatchObject({ medium: "paid-social", campaign: "always-on" });
  });
});

describe("generateSlug", () => {
  it("avoids visually ambiguous characters", () => {
    const slugs = Array.from({ length: 200 }, () => generateSlug()).join("");
    // These get read aloud and typed by hand.
    expect(slugs).not.toMatch(/[0O1lI]/);
  });

  it("produces the requested length", () => {
    expect(generateSlug()).toHaveLength(7);
    expect(generateSlug(12)).toHaveLength(12);
  });

  it("does not repeat across a large sample", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateSlug()));
    expect(seen.size).toBe(500);
  });
});

describe("short link lifecycle", () => {
  let dbDir: string;
  let ORIGINAL_DB: string | undefined;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    dbDir = mkdtempSync(join(tmpdir(), "socmed-links-"));
    ORIGINAL_DB = process.env.SOCMED_DB_PATH;
    process.env.SOCMED_DB_PATH = join(dbDir, "test.db");
    const { sqlite } = await import("@db/client");
    sqlite.exec("PRAGMA journal_mode = WAL");
    const { runMigrations } = await import("@db/migrate");
    await runMigrations();
  }, 120_000);

  afterAll(() => {
    if (ORIGINAL_DB !== undefined) process.env.SOCMED_DB_PATH = ORIGINAL_DB;
    Object.assign(process.env, savedEnv);
    try {
      rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // Windows can hold SQLite file locks briefly — best-effort cleanup.
    }
  });

  beforeEach(() => {
    process.env.SOCMED_SHORTEN_LINKS = "true";
    process.env.SOCMED_PUBLIC_URL = "https://social.example.com";
  });

  it("mints a link on the configured origin", async () => {
    const { createShortLink } = await import("@/lib/links/shorten");
    const r = createShortLink("https://example.com/a?utm_source=twitter");
    expect(r).not.toBeNull();
    expect(r!.url).toBe(`https://social.example.com/s/${r!.slug}`);
  });

  it("counts a click and resolves the target", async () => {
    const { createShortLink, resolveAndCount } = await import("@/lib/links/shorten");
    const { sqlite } = await import("@db/client");
    const r = createShortLink("https://example.com/counted")!;

    expect(resolveAndCount(r.slug)?.targetUrl).toBe("https://example.com/counted");
    resolveAndCount(r.slug);
    resolveAndCount(r.slug);

    const row = sqlite.prepare(`SELECT clicks, last_clicked_at FROM short_links WHERE slug = ?`).get(r.slug) as {
      clicks: number; last_clicked_at: number | null;
    };
    expect(row.clicks).toBe(3);
    expect(row.last_clicked_at).not.toBeNull();
  });

  it("returns null for an unknown slug rather than throwing", async () => {
    const { resolveAndCount } = await import("@/lib/links/shorten");
    expect(resolveAndCount("nope1234")).toBeNull();
  });

  it("stays off when the feature flag is unset", async () => {
    const { createShortLink } = await import("@/lib/links/shorten");
    delete process.env.SOCMED_SHORTEN_LINKS;
    expect(createShortLink("https://example.com/x")).toBeNull();
  });

  it("refuses to mint without a usable public origin", async () => {
    const { createShortLink } = await import("@/lib/links/shorten");
    // A link on an unknown origin resolves to nothing; publishing the full URL
    // is strictly better.
    process.env.SOCMED_PUBLIC_URL = "not-a-url";
    expect(createShortLink("https://example.com/x")).toBeNull();
    delete process.env.SOCMED_PUBLIC_URL;
    expect(createShortLink("https://example.com/x")).toBeNull();
  });

  it("refuses a non-http target", async () => {
    const { createShortLink } = await import("@/lib/links/shorten");
    expect(createShortLink("javascript:alert(1)")).toBeNull();
    expect(createShortLink("file:///etc/passwd")).toBeNull();
  });
});
