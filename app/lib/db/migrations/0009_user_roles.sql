-- Roles for multi-user support.
--
-- The default is the least-privileged role so a row inserted without an
-- explicit role can never silently gain admin. Every user that exists at
-- migration time is the single env-seeded operator, so they are promoted to
-- admin immediately afterwards — defaulting to 'admin' instead would have
-- backfilled correctly here but left the unsafe default in place for good.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer';
UPDATE users SET role = 'admin';

-- Deactivating without deleting: posts and audit trails keep referencing the
-- user, but their session stops working on the next request.
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
