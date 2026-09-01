-- TOTP enrolment. The shared secret is envelope-encrypted the same way platform
-- credentials are (AES-256-GCM, per-user key via HKDF from SOCMED_MASTER_KEY),
-- under a distinct HKDF scope so user 7's key is unrelated to account 7's.
ALTER TABLE users ADD COLUMN totp_secret BLOB;
ALTER TABLE users ADD COLUMN totp_iv BLOB;
ALTER TABLE users ADD COLUMN totp_tag BLOB;

-- A secret exists from the moment enrolment starts, but only counts once the
-- user has proved they can generate a code from it.
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- Highest TOTP counter already accepted. A code is valid for up to 90 seconds
-- across the skew window, so without this a captured code can just be replayed.
ALTER TABLE users ADD COLUMN totp_last_step INTEGER;
