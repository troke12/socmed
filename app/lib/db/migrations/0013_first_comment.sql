-- Optional follow-up comment posted immediately after a post publishes.
-- Instagram convention is hashtags in the first comment rather than the caption,
-- which keeps the caption readable without losing reach.
ALTER TABLE posts ADD COLUMN first_comment TEXT;

-- Set once the comment actually lands, so a retry cannot double-post it and the
-- UI can distinguish "queued" from "delivered".
ALTER TABLE posts ADD COLUMN first_comment_posted_at INTEGER;
