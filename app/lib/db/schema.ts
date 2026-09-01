import { sqliteTable, text, integer, real, blob, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "editor", "viewer"] })
    .notNull()
    .default("viewer"),
  disabled: integer("disabled").notNull().default(0),
  totpSecret: blob("totp_secret", { mode: "buffer" }),
  totpIv: blob("totp_iv", { mode: "buffer" }),
  totpTag: blob("totp_tag", { mode: "buffer" }),
  totpEnabled: integer("totp_enabled").notNull().default(0),
  totpLastStep: integer("totp_last_step"),
  createdAt: integer("created_at").notNull(),
});

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    prefix: text("prefix").notNull(),
    // Capped below admin on purpose — see lib/auth/api-token.ts.
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: integer("last_used_at"),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    hashIdx: index("api_tokens_hash_idx").on(t.tokenHash),
  }),
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    platform: text("platform", {
      enum: [
        "tiktok",
        "linkedin",
        "instagram",
        "x",
        "facebook",
        "threads",
        "youtube",
        "pinterest",
        "reddit",
        "mastodon",
        "bluesky",
        "discord",
      ],
    }).notNull(),
    // Internal label for the user (e.g. "Marketing X", "Personal IG"). Unique per platform.
    label: text("label").notNull(),
    handle: text("handle").notNull().default(""),
    displayName: text("display_name"),
    encryptedCreds: blob("encrypted_creds", { mode: "buffer" }).notNull(),
    credsIv: blob("creds_iv", { mode: "buffer" }).notNull(),
    credsTag: blob("creds_tag", { mode: "buffer" }).notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    scopes: text("scopes").notNull().default("[]"),
    tokenExpiresAt: integer("token_expires_at"),
    lastRefreshAt: integer("last_refresh_at"),
    // For Mastodon: instance URL. For Discord: guild ID. For Bluesky: PDS URL. etc.
    instanceUrl: text("instance_url"),
    status: text("status", { enum: ["active", "revoked", "expired"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    platformLabelUq: uniqueIndex("accounts_platform_label_uq").on(t.platform, t.label),
  }),
);

export const mediaAssets = sqliteTable("media_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull(),
  kind: text("kind", { enum: ["image", "video"] }).notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationMs: integer("duration_ms"),
  posterPath: text("poster_path"),
  altText: text("alt_text"),
  sha256: text("sha256").notNull().unique(),
  createdAt: integer("created_at").notNull(),
});

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["text", "image", "video", "carousel", "link"] }).notNull(),
    status: text("status", {
      enum: ["draft", "scheduled", "publishing", "published", "failed", "archived"],
    })
      .notNull()
      .default("draft"),
    caption: text("caption").notNull().default(""),
    hashtags: text("hashtags").notNull().default(""),
    linkUrl: text("link_url"),
    campaign: text("campaign"),
    firstComment: text("first_comment"),
    firstCommentPostedAt: integer("first_comment_posted_at"),
    scheduledFor: integer("scheduled_for"),
    publishedAt: integer("published_at"),
    platformPostId: text("platform_post_id"),
    platformPostUrl: text("platform_post_url"),
    error: text("error"),
    attemptCount: integer("attempt_count").notNull().default(0),
    // Review state is tracked separately from status: "awaiting approval" and
    // "scheduled for Tuesday" are independent facts about the same post.
    reviewStatus: text("review_status", { enum: ["none", "pending", "approved", "rejected"] })
      .notNull()
      .default("none"),
    authorId: integer("author_id").references(() => users.id, { onDelete: "set null" }),
    reviewerId: integer("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: integer("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => ({
    statusIdx: index("posts_status_idx").on(t.status),
    accountIdx: index("posts_account_idx").on(t.accountId),
    reviewIdx: index("posts_review_pending_idx").on(t.reviewStatus),
  }),
);

export const postMedia = sqliteTable(
  "post_media",
  {
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    mediaId: integer("media_id")
      .notNull()
      .references(() => mediaAssets.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => ({
    pk: uniqueIndex("post_media_pk").on(t.postId, t.mediaId),
  }),
);

export const scheduleRules = sqliteTable("schedule_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cronExpr: text("cron_expr").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  templatePostId: integer("template_post_id").references(() => posts.id, { onDelete: "set null" }),
  enabled: integer("enabled").notNull().default(1),
  nextRunAt: integer("next_run_at").notNull(),
  lastRunAt: integer("last_run_at"),
  createdAt: integer("created_at").notNull(),
});

export const shortLinks = sqliteTable(
  "short_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    targetUrl: text("target_url").notNull(),
    postId: integer("post_id").references(() => posts.id, { onDelete: "set null" }),
    accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
    clicks: integer("clicks").notNull().default(0),
    lastClickedAt: integer("last_clicked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    postIdx: index("short_links_post_idx").on(t.postId),
  }),
);

export const analyticsSnapshots = sqliteTable(
  "analytics_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    capturedAt: integer("captured_at").notNull(),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    likes: integer("likes").notNull().default(0),
    comments: integer("comments").notNull().default(0),
    shares: integer("shares").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    videoViews: integer("video_views").notNull().default(0),
    watchTimeMs: integer("watch_time_ms").notNull().default(0),
    engagementRate: real("engagement_rate").notNull().default(0),
    rawJson: text("raw_json"),
  },
  (t) => ({
    postTime: index("analytics_post_time").on(t.postId, t.capturedAt),
    accountTime: index("analytics_account_time").on(t.accountId, t.capturedAt),
  }),
);

export const mentions = sqliteTable(
  "mentions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformMentionId: text("platform_mention_id").notNull(),
    authorHandle: text("author_handle").notNull(),
    authorName: text("author_name"),
    text: text("text").notNull(),
    url: text("url"),
    mentionedAt: integer("mentioned_at").notNull(),
    isRead: integer("is_read").notNull().default(0),
    rawJson: text("raw_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uq: uniqueIndex("mentions_platform_id_uq").on(t.platform, t.platformMentionId),
    accountTime: index("mentions_account_time").on(t.accountId, t.mentionedAt),
  }),
);

export const comments = sqliteTable(
  "comments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    platformCommentId: text("platform_comment_id").notNull(),
    authorHandle: text("author_handle").notNull(),
    text: text("text").notNull(),
    postedAt: integer("posted_at").notNull(),
    isReplied: integer("is_replied").notNull().default(0),
    replyId: text("reply_id"),
    rawJson: text("raw_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => ({
    uq: uniqueIndex("comments_platform_id_uq").on(t.platform, t.platformCommentId),
    post: index("comments_post").on(t.postId, t.postedAt),
  }),
);

export const engagementActions = sqliteTable(
  "engagement_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["reply", "like", "reshare"] }).notNull(),
    targetType: text("target_type", { enum: ["comment", "mention", "post"] }).notNull(),
    targetId: integer("target_id").notNull(),
    replyText: text("reply_text"),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (t) => ({
    statusIdx: index("engagement_actions_status").on(t.status, t.createdAt),
  }),
);

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  payload: text("payload").notNull(),
  runAt: integer("run_at").notNull(),
  claimedAt: integer("claimed_at"),
  claimedBy: text("claimed_by"),
  status: text("status", { enum: ["pending", "running", "done", "failed", "dead"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Role = User["role"];
export type ApiToken = typeof apiTokens.$inferSelect;
export type ApiTokenRole = ApiToken["role"];
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Platform = Account["platform"];
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type PostStatus = Post["status"];
export type ReviewStatus = Post["reviewStatus"];
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type ScheduleRule = typeof scheduleRules.$inferSelect;
export type ShortLink = typeof shortLinks.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobKind =
  | "publish_post"
  | "fetch_metrics"
  | "fetch_mentions"
  | "post_comment"
  | "first_comment"
  | "refresh_token"
  | "schedule_rule";
