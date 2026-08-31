-- M3.5: multi-account + new platforms (discord, facebook, threads, youtube, pinterest, reddit, mastodon, bluesky)
-- Drop old unique constraint, add label/instanceUrl, expand platform enum

DROP INDEX IF EXISTS accounts_platform_handle_uq;

-- Add columns
ALTER TABLE accounts ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN instance_url TEXT;

-- Backfill label from handle for existing rows
UPDATE accounts SET label = handle WHERE label = '' OR label IS NULL;

-- Make label required (no longer has default since we backfilled)
-- SQLite can't easily ALTER COLUMN, but NOT NULL with default '' is fine for inserts
-- We won't enforce that existing rows have non-empty label beyond the backfill.

CREATE UNIQUE INDEX accounts_platform_label_uq ON accounts(platform, label);
