-- Internal link shortener + click tracking.
--
-- target_url is not unique: the same destination can legitimately be shortened
-- once per post so clicks are attributable to the post that drove them, which
-- is the entire point of the feature.
CREATE TABLE short_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  last_clicked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX short_links_post_idx ON short_links(post_id);

-- Per-post campaign name for utm_campaign. Nullable: most posts do not belong
-- to a named campaign, and an empty utm_campaign is worse than none at all.
ALTER TABLE posts ADD COLUMN campaign TEXT;
