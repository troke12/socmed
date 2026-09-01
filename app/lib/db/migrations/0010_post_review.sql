-- Review state is deliberately NOT a new value in posts.status.
--
-- status carries a CHECK constraint (0003_posts.sql) and SQLite cannot alter
-- one without rebuilding the table, which is unsafe to do here: migrations run
-- inside a transaction, so `PRAGMA foreign_keys = OFF` is a no-op, and five
-- other tables hold references to posts(id).
--
-- Keeping the two orthogonal is also the better model: "awaiting approval" and
-- "scheduled for Tuesday" are independent facts, and every existing status
-- filter, index and analytics query keeps working untouched.
ALTER TABLE posts ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none'
  CHECK (review_status IN ('none','pending','approved','rejected'));
ALTER TABLE posts ADD COLUMN author_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN reviewed_at INTEGER;
ALTER TABLE posts ADD COLUMN review_note TEXT;

-- Partial index: the review queue only ever asks for pending rows.
CREATE INDEX posts_review_pending_idx ON posts(review_status) WHERE review_status = 'pending';
