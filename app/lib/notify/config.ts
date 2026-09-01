import type { NotifyEvent } from "./types";

const ALL_EVENTS: NotifyEvent[] = ["publish_failed", "new_mentions", "account_expired"];

export interface NotifyConfig {
  webhookUrl: string | null;
  slackWebhookUrl: string | null;
  smtpUrl: string | null;
  emailTo: string | null;
  emailFrom: string;
  events: NotifyEvent[];
  publicUrl: string | null;
}

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/**
 * Notification config, entirely from env.
 *
 * These URLs are operator configuration, not user input, so they are not run
 * through the SSRF guard in lib/security/url.ts. An operator pointing this at
 * an internal collector on a private address is a legitimate self-hosted setup,
 * and refusing it would be wrong. Only the scheme is checked.
 */
export function notifyConfig(): NotifyConfig {
  const rawEvents = env("SOCMED_NOTIFY_EVENTS");
  const events = rawEvents
    ? (rawEvents.split(",").map((s) => s.trim()).filter((s): s is NotifyEvent =>
        (ALL_EVENTS as string[]).includes(s),
      ))
    : ALL_EVENTS;

  return {
    webhookUrl: httpOnly(env("SOCMED_NOTIFY_WEBHOOK_URL")),
    slackWebhookUrl: httpOnly(env("SOCMED_NOTIFY_SLACK_WEBHOOK_URL")),
    smtpUrl: env("SOCMED_SMTP_URL"),
    emailTo: env("SOCMED_NOTIFY_EMAIL_TO"),
    emailFrom: env("SOCMED_NOTIFY_EMAIL_FROM") ?? "socmed@localhost",
    events,
    publicUrl: env("SOCMED_PUBLIC_URL"),
  };
}

function httpOnly(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export function isEnabled(config: NotifyConfig): boolean {
  return Boolean(config.webhookUrl || config.slackWebhookUrl || (config.smtpUrl && config.emailTo));
}

export function wants(config: NotifyConfig, event: NotifyEvent): boolean {
  return config.events.includes(event);
}
