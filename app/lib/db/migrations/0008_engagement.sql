-- M5: mentions, comments, engagement_actions
CREATE TABLE mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_mention_id TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  author_name TEXT,
  text TEXT NOT NULL,
  url TEXT,
  mentioned_at INTEGER NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(platform, platform_mention_id)
);
CREATE INDEX mentions_account_time ON mentions(account_id, mentioned_at);
CREATE INDEX mentions_unread ON mentions(account_id, is_read);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_comment_id TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  text TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  is_replied INTEGER NOT NULL DEFAULT 0,
  reply_id TEXT,
  raw_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(platform, platform_comment_id)
);
CREATE INDEX comments_post ON comments(post_id, posted_at);
CREATE INDEX comments_unreplied ON comments(account_id, is_replied);

CREATE TABLE engagement_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('reply','like','reshare')),
  target_type TEXT NOT NULL CHECK (target_type IN ('comment','mention','post')),
  target_id INTEGER NOT NULL,
  reply_text TEXT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);
CREATE INDEX engagement_actions_status ON engagement_actions(status, created_at);
