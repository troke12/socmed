export type NotifyEvent = "publish_failed" | "new_mentions" | "account_expired";

export interface Notification {
  event: NotifyEvent;
  /** One-line summary, used as the subject and the Slack fallback text. */
  title: string;
  body: string;
  /** Relative path into the app, if there is somewhere useful to go. */
  path?: string;
  /** Structured payload for a generic webhook consumer. */
  data?: Record<string, unknown>;
}

export interface Transport {
  readonly name: string;
  send(n: Notification): Promise<void>;
}
