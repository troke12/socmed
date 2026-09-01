import type { NotifyConfig } from "./config";
import type { Notification, Transport } from "./types";

const TIMEOUT_MS = 10_000;

function absoluteLink(config: NotifyConfig, n: Notification): string | null {
  if (!n.path || !config.publicUrl) return null;
  try {
    return new URL(n.path, config.publicUrl).toString();
  } catch {
    return null;
  }
}

async function postJson(url: string, payload: unknown): Promise<void> {
  // A hung notification endpoint must not hold a queue worker open.
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
}

export function webhookTransport(config: NotifyConfig): Transport | null {
  if (!config.webhookUrl) return null;
  const url = config.webhookUrl;
  return {
    name: "webhook",
    async send(n) {
      await postJson(url, {
        event: n.event,
        title: n.title,
        body: n.body,
        url: absoluteLink(config, n),
        data: n.data ?? {},
        at: new Date().toISOString(),
      });
    },
  };
}

export function slackTransport(config: NotifyConfig): Transport | null {
  if (!config.slackWebhookUrl) return null;
  const url = config.slackWebhookUrl;
  return {
    name: "slack",
    async send(n) {
      const link = absoluteLink(config, n);
      // `text` doubles as the notification preview on mobile, so it carries the
      // title rather than being left empty alongside blocks.
      await postJson(url, {
        text: n.title,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*${n.title}*` } },
          { type: "section", text: { type: "mrkdwn", text: n.body } },
          ...(link
            ? [{
                type: "actions",
                elements: [{ type: "button", text: { type: "plain_text", text: "Open socmed" }, url: link }],
              }]
            : []),
        ],
      });
    },
  };
}

/**
 * SMTP transport. nodemailer is imported lazily so an install with no SMTP
 * configured never loads it, and so a missing optional dependency degrades to
 * "email disabled" instead of crashing the worker at boot.
 */
export function emailTransport(config: NotifyConfig): Transport | null {
  if (!config.smtpUrl || !config.emailTo) return null;
  const { smtpUrl, emailTo, emailFrom } = config;
  return {
    name: "email",
    async send(n) {
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport(smtpUrl);
      const link = absoluteLink(config, n);
      await transporter.sendMail({
        from: emailFrom,
        to: emailTo,
        subject: `[socmed] ${n.title}`,
        text: [n.body, link ? `\n${link}` : ""].filter(Boolean).join("\n"),
      });
    },
  };
}

export function transportsFor(config: NotifyConfig): Transport[] {
  return [webhookTransport(config), slackTransport(config), emailTransport(config)].filter(
    (t): t is Transport => t !== null,
  );
}
