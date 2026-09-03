-- Follower/audience counts over time.
--
-- Its own table rather than columns on analytics_snapshots: audience is
-- account-scoped while a snapshot there is post-scoped, so hanging it off that
-- table would mean a null on every existing row and a follower count repeated
-- once per post per poll.
CREATE TABLE audience_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  captured_at INTEGER NOT NULL,
  -- Nullable rather than 0: "the platform does not report this" and "you have
  -- zero followers" are different facts, and averaging the second into a growth
  -- chart would be a lie.
  followers INTEGER,
  following INTEGER,
  posts INTEGER,
  raw_json TEXT
);
CREATE INDEX audience_account_time ON audience_snapshots(account_id, captured_at);

-- One row per account per day is the resolution a growth chart needs; this stops
-- a restarted worker from stacking several for the same day.
CREATE UNIQUE INDEX audience_account_day_uq
  ON audience_snapshots(account_id, captured_at);
