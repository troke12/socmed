import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { notifyConfig, isEnabled, wants } from "@/lib/notify/config";
import { webhookTransport, slackTransport, emailTransport, transportsFor } from "@/lib/notify/transports";
import type { Notification } from "@/lib/notify/types";

const saved = { ...process.env };

const NOTIFY_KEYS = [
  "SOCMED_NOTIFY_WEBHOOK_URL",
  "SOCMED_NOTIFY_SLACK_WEBHOOK_URL",
  "SOCMED_NOTIFY_EVENTS",
  "SOCMED_SMTP_URL",
  "SOCMED_NOTIFY_EMAIL_TO",
  "SOCMED_NOTIFY_EMAIL_FROM",
  "SOCMED_PUBLIC_URL",
];

beforeEach(() => {
  for (const k of NOTIFY_KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

afterAll(() => { Object.assign(process.env, saved); });

const sample: Notification = {
  event: "publish_failed",
  title: "Publish failed on x (Marketing)",
  body: "Post #12 gave up after 5 attempts.",
  path: "/compose?id=12",
  data: { postId: 12 },
};

describe("config", () => {
  it("is disabled when nothing is configured", () => {
    expect(isEnabled(notifyConfig())).toBe(false);
  });

  it("is enabled by a webhook alone", () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    expect(isEnabled(notifyConfig())).toBe(true);
  });

  it("needs both an SMTP url and a recipient for email to count", () => {
    process.env.SOCMED_SMTP_URL = "smtp://localhost:1025";
    // Nowhere to send it is not a working configuration.
    expect(isEnabled(notifyConfig())).toBe(false);
    process.env.SOCMED_NOTIFY_EMAIL_TO = "ops@example.com";
    expect(isEnabled(notifyConfig())).toBe(true);
  });

  it("rejects a non-http webhook scheme", () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "file:///etc/passwd";
    expect(notifyConfig().webhookUrl).toBeNull();
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "not a url";
    expect(notifyConfig().webhookUrl).toBeNull();
  });

  it("allows a private address, because this is operator config", () => {
    // A self-hosted install pointing at an internal collector is legitimate;
    // the SSRF guard used for user-supplied URLs would wrongly refuse it.
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "http://192.168.1.10:9000/hook";
    expect(notifyConfig().webhookUrl).toBe("http://192.168.1.10:9000/hook");
  });

  it("subscribes to every event by default", () => {
    const c = notifyConfig();
    expect(wants(c, "publish_failed")).toBe(true);
    expect(wants(c, "new_mentions")).toBe(true);
    expect(wants(c, "account_expired")).toBe(true);
  });

  it("honours an explicit event list and ignores unknown names", () => {
    process.env.SOCMED_NOTIFY_EVENTS = "publish_failed, nonsense ,account_expired";
    const c = notifyConfig();
    expect(wants(c, "publish_failed")).toBe(true);
    expect(wants(c, "account_expired")).toBe(true);
    expect(wants(c, "new_mentions")).toBe(false);
  });
});

describe("transports", () => {
  function mockFetch(): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("returns no transports when nothing is configured", () => {
    expect(transportsFor(notifyConfig())).toHaveLength(0);
  });

  it("posts a flat JSON payload to a generic webhook", async () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    process.env.SOCMED_PUBLIC_URL = "https://social.example.com";
    const fetchMock = mockFetch();

    await webhookTransport(notifyConfig())!.send(sample);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/x");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ event: "publish_failed", title: sample.title, data: { postId: 12 } });
    // The relative path is resolved against the public URL so the alert is
    // clickable from wherever it lands.
    expect(body.url).toBe("https://social.example.com/compose?id=12");
  });

  it("omits the link when no public URL is set", async () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    const fetchMock = mockFetch();
    await webhookTransport(notifyConfig())!.send(sample);
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.url).toBeNull();
  });

  it("sends Slack blocks with the title also in text", async () => {
    process.env.SOCMED_NOTIFY_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/x";
    const fetchMock = mockFetch();

    await slackTransport(notifyConfig())!.send(sample);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    // `text` is what Slack shows in the mobile push preview, so leaving it
    // empty next to blocks would produce a blank notification.
    expect(body.text).toBe(sample.title);
    expect(body.blocks[0].text.text).toContain(sample.title);
  });

  it("surfaces a non-2xx response as an error", async () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500, statusText: "Server Error" })));
    await expect(webhookTransport(notifyConfig())!.send(sample)).rejects.toThrow(/500/);
  });

  it("builds an email transport only with a full configuration", () => {
    expect(emailTransport(notifyConfig())).toBeNull();
    process.env.SOCMED_SMTP_URL = "smtp://localhost:1025";
    expect(emailTransport(notifyConfig())).toBeNull();
    process.env.SOCMED_NOTIFY_EMAIL_TO = "ops@example.com";
    expect(emailTransport(notifyConfig())?.name).toBe("email");
  });
});

describe("notify", () => {
  it("never throws when a transport fails", async () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { notify } = await import("@/lib/notify");
    // Called from queue handlers: the post publishing correctly matters more
    // than the alert about it being delivered.
    await expect(notify(sample)).resolves.toBeUndefined();
  });

  it("does nothing for an unsubscribed event", async () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    process.env.SOCMED_NOTIFY_EVENTS = "new_mentions";
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { notify } = await import("@/lib/notify");
    await notify(sample);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps going when one transport fails and another succeeds", async () => {
    process.env.SOCMED_NOTIFY_WEBHOOK_URL = "https://hooks.example.com/x";
    process.env.SOCMED_NOTIFY_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/x";
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("slack") ? new Response("ok", { status: 200 }) : new Response("no", { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchMock as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { notify } = await import("@/lib/notify");
    await notify(sample);
    // Both attempted — one bad endpoint must not suppress the other.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
