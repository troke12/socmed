-- API tokens for external automation.
--
-- Only the SHA-256 of the token is stored. A leaked database therefore does not
-- yield usable tokens. SHA-256 rather than bcrypt on purpose: the token is 32
-- bytes of CSPRNG output, so there is nothing to brute-force, and a slow KDF
-- would be paid on every single API request.
CREATE TABLE api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  -- First few characters, kept in clear so the UI can tell two tokens apart
  -- after the secret has been shown once and discarded.
  prefix TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_used_at INTEGER,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX api_tokens_hash_idx ON api_tokens(token_hash);
