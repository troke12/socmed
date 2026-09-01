import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { xReplyToTweet } from "@platforms/x/client";
import { instagramReplyToComment, instagramCommentOnMedia } from "@platforms/instagram/client";
import { linkedinCreateComment } from "@platforms/linkedin/client";
import { youtubeCommentOnVideo } from "@platforms/youtube/client";

/**
 * These tests pin the request shapes against the platform documentation. #32 was
 * caused by adapters that returned success without issuing a request at all, so
 * asserting the exact endpoint and body is the thing that keeps it from
 * regressing.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: Call[];

function mockFetch(responder: (url: string) => Response): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      return responder(url);
    }),
  );
}

const json = (body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...extra } });

beforeEach(() => { calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

describe("X reply", () => {
  it("posts to /2/tweets with reply.in_reply_to_tweet_id", async () => {
    mockFetch(() => json({ data: { id: "9001" } }));
    const r = await xReplyToTweet("1234", "thanks!", "tok");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.x.com/2/tweets");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.authorization).toBe("Bearer tok");
    // The reply target is nested — a flat in_reply_to_tweet_id is ignored and
    // silently produces a standalone post instead of a reply.
    expect(calls[0]!.body).toEqual({ text: "thanks!", reply: { in_reply_to_tweet_id: "1234" } });
    expect(r.id).toBe("9001");
  });

  it("surfaces a non-2xx instead of reporting success", async () => {
    mockFetch(() => new Response("nope", { status: 403, statusText: "Forbidden" }));
    await expect(xReplyToTweet("1", "x", "tok")).rejects.toThrow(/X reply: 403/);
  });
});

describe("Instagram comments", () => {
  it("replies on the /replies edge of a comment", async () => {
    mockFetch(() => json({ id: "c1" }));
    await instagramReplyToComment("17900000000000000", "thanks!", "tok");

    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/17900000000000000/replies");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ message: "thanks!" });
  });

  it("comments on the /comments edge of a media object", async () => {
    mockFetch(() => json({ id: "c2" }));
    await instagramCommentOnMedia("18000000000000000", "#tags", "tok");

    // A different edge from the reply above; using the wrong one is not a
    // near-miss, it is a 400.
    expect(calls[0]!.url).toBe("https://graph.instagram.com/v25.0/18000000000000000/comments");
    expect(calls[0]!.body).toEqual({ message: "#tags" });
  });

  it("surfaces a non-2xx", async () => {
    mockFetch(() => new Response("bad", { status: 400 }));
    await expect(instagramCommentOnMedia("1", "x", "tok")).rejects.toThrow(/Instagram comment: 400/);
  });
});

describe("LinkedIn comments", () => {
  const userinfo = (url: string) =>
    url.includes("/v2/userinfo") ? json({ sub: "abc123" }) : json({}, { "x-restli-id": "7102986562019213313" });

  it("posts a top-level comment with actor, object and message.text", async () => {
    mockFetch(userinfo);
    const r = await linkedinCreateComment("urn:li:share:7096760097833439232", "nice post", "tok");

    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe(
      "https://api.linkedin.com/rest/socialActions/urn%3Ali%3Ashare%3A7096760097833439232/comments",
    );
    expect(post.body).toEqual({
      actor: "urn:li:person:abc123",
      object: "urn:li:share:7096760097833439232",
      message: { text: "nice post" },
    });
    // Both are mandatory on every /rest call; omitting either returns a 400.
    expect(post.headers["linkedin-version"]).toBeTruthy();
    expect(post.headers["x-restli-protocol-version"]).toBe("2.0.0");
    // The id lives in the header — the body can be empty.
    expect(r.id).toBe("7102986562019213313");
  });

  it("adds parentComment only when replying", async () => {
    mockFetch(userinfo);
    await linkedinCreateComment("urn:li:share:1", "reply", "tok", {
      parentComment: "urn:li:comment:(urn:li:share:1,999)",
    });
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toMatchObject({ parentComment: "urn:li:comment:(urn:li:share:1,999)" });
  });

  it("fails loudly when neither header nor body carries an id", async () => {
    mockFetch((url) => (url.includes("/v2/userinfo") ? json({ sub: "abc" }) : json({})));
    await expect(linkedinCreateComment("urn:li:share:1", "x", "tok")).rejects.toThrow(/no id in header or body/);
  });

  it("surfaces a 403, which is what an app without w_member_social_feed gets", async () => {
    mockFetch((url) =>
      url.includes("/v2/userinfo") ? json({ sub: "abc" }) : new Response("denied", { status: 403 }),
    );
    await expect(linkedinCreateComment("urn:li:share:1", "x", "tok")).rejects.toThrow(/LinkedIn comment: 403/);
  });
});

describe("YouTube top-level comment", () => {
  it("uses commentThreads with videoId and channelId", async () => {
    mockFetch((url) =>
      url.includes("/channels") ? json({ items: [{ id: "UC123", snippet: { title: "Chan" } }] }) : json({ id: "t1" }),
    );
    await youtubeCommentOnVideo("vid123", "#tags", "tok");

    const post = calls.find((c) => c.method === "POST")!;
    // commentThreads, not comments: comments.insert needs a parent comment id
    // and cannot open a new thread on a video.
    expect(post.url).toContain("/commentThreads?part=snippet");
    expect(post.body).toEqual({
      snippet: {
        videoId: "vid123",
        // Mandatory alongside videoId per the API reference.
        channelId: "UC123",
        topLevelComment: { snippet: { textOriginal: "#tags" } },
      },
    });
  });

  it("surfaces a non-2xx", async () => {
    mockFetch((url) =>
      url.includes("/channels") ? json({ items: [{ id: "UC1", snippet: { title: "c" } }] }) : new Response("no", { status: 401 }),
    );
    await expect(youtubeCommentOnVideo("v", "x", "tok")).rejects.toThrow(/YouTube comment: 401/);
  });
});
