-- M1: users + accounts
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok','linkedin','instagram','x')),
  handle TEXT NOT NULL,
  display_name TEXT,
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

CREATE UNIQUE INDEX accounts_platform_handle_uq ON accounts(platform, handle);
