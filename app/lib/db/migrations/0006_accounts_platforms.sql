-- M3.5: expand accounts.platform CHECK constraint to include all 12 platforms.
-- SQLite can't ALTER CHECK constraints, so we recreate the table.
-- (Note: migrate.ts already wraps this in a transaction; we do NOT use BEGIN/COMMIT here.)

CREATE TABLE accounts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN (
    'tiktok','linkedin','instagram','x',
    'facebook','threads','youtube','pinterest','reddit',
    'mastodon','bluesky','discord'
  )),
  label TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  display_name TEXT,
  instance_url TEXT,
  encrypted_creds BLOB NOT NULL,
  creds_iv BLOB NOT NULL,
  creds_tag BLOB NOT NULL,
  webhook_secret TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  token_expires_at INTEGER,
  last_refresh_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  created_at INTEGER NOT NULL
);

INSERT INTO accounts_new
  (id, platform, label, handle, display_name, instance_url,
   encrypted_creds, creds_iv, creds_tag, webhook_secret, scopes,
   token_expires_at, last_refresh_at, status, created_at)
SELECT
  id, platform, COALESCE(label, ''), COALESCE(handle, ''), display_name, instance_url,
  encrypted_creds, creds_iv, creds_tag, webhook_secret, scopes,
  token_expires_at, last_refresh_at, status, created_at
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

CREATE UNIQUE INDEX accounts_platform_label_uq ON accounts(platform, label);
