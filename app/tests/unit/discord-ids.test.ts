import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { discordAdapter } from "@platforms/discord/adapter";
import type { AdapterContext, PublishInput } from "@platforms/types";

/**
 * Every Discord REST call puts the channel in the path, so a message id alone
 * cannot address a message. These tests pin the composite id format and the
 * recovery path for rows written before it.
 */

interface Call { url: string; method: string; auth: string | undefined; body: unknown }
let calls: Call[];

function mockFetch(response: () => Response): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        auth: headers.authorization,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      });
      return response();
    }),
  );
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function ctx(channelIds: string[]): AdapterContext {
  return {
    post: {} as never,
    account: {
      _creds: { accessToken: "bot-token", raw: { channelIds, guildId: "g1" } },
    } as never,
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.restoreAllMocks(); });

describe("publishPost id format", () => {
  it("stores channelId|messageId, not a bare message id", async () => {
    mockFetch(() => ok({ id: "m1", channel_id: "c1", guild_id: "g1" }));
    const input = {
      postId: 1,
      caption: "hello",
      rawCreds: { accessToken: "bot-token", raw: { channelIds: ["c1"] } },
    } as unknown as PublishInput;

    const r = await discordAdapter.publishPost(input, ctx(["c1"]));
    // A bare message id cannot be deleted or replied to later.
    expect(r.platformPostId).toBe("c1|m1");
  });
});

describe("deletePost", () => {
  it("authenticates with the bot token, not the channel id", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await discordAdapter.deletePost("c1|m1", "unused", ctx(["c1"]));

    expect(calls[0]!.url).toContain("/channels/c1/messages/m1");
    expect(calls[0]!.method).toBe("DELETE");
    // This used to be `Bot c1` — the channel id in the token position, so every
    // delete failed authentication.
    expect(calls[0]!.auth).toBe("Bot bot-token");
  });

  it("recovers a legacy bare id when the account has exactly one channel", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await discordAdapter.deletePost("m1", "unused", ctx(["c1"]));
    expect(calls[0]!.url).toContain("/channels/c1/messages/m1");
  });

  it("refuses a legacy bare id when several channels are configured", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    // Guessing would delete in the wrong channel.
    await expect(discordAdapter.deletePost("m1", "unused", ctx(["c1", "c2"]))).rejects.toThrow(
      /cannot resolve the channel/,
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a legacy bare id when no channel is configured", async () => {
    mockFetch(() => new Response(null, { status: 204 }));
    await expect(discordAdapter.deletePost("m1", "unused", ctx([]))).rejects.toThrow(
      /no configured channel/,
    );
  });
});

describe("comments", () => {
  it("replies in the referenced message's channel and returns a composite id", async () => {
    mockFetch(() => ok({ id: "m2", channel_id: "c1", guild_id: "g1" }));
    const r = await discordAdapter.postCommentReply("c1|m1", "thanks", "unused", ctx(["c1"]));

    expect(calls[0]!.url).toContain("/channels/c1/messages");
    expect(calls[0]!.body).toMatchObject({ content: "thanks", message_reference: { message_id: "m1" } });
    // Composite so the reply can itself be replied to.
    expect(r.platformCommentId).toBe("c1|m2");
  });

  it("posts a first comment as a reply to the post", async () => {
    mockFetch(() => ok({ id: "m3", channel_id: "c1", guild_id: "g1" }));
    const r = await discordAdapter.postComment!("c1|m1", "#tags", "unused", ctx(["c1"]));
    expect(calls[0]!.body).toMatchObject({ message_reference: { message_id: "m1" } });
    expect(r.platformCommentId).toBe("c1|m3");
  });
});
