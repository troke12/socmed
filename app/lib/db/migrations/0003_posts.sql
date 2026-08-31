-- M2: posts, post_media, schedule_rules
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text','image','video','carousel','link')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','publishing','published','failed','archived')),
  caption TEXT NOT NULL DEFAULT '',
  hashtags TEXT NOT NULL DEFAULT '',
  link_url TEXT,
  scheduled_for INTEGER,
  published_at INTEGER,
  platform_post_id TEXT,
  platform_post_url TEXT,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX posts_status_idx ON posts(status);
CREATE INDEX posts_scheduled_idx ON posts(scheduled_for) WHERE status='scheduled';
CREATE INDEX posts_account_idx ON posts(account_id);

CREATE TABLE post_media (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE schedule_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  template_post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX schedule_rules_next_idx ON schedule_rules(next_run_at) WHERE enabled=1;
