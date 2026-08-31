-- M2: media_assets
CREATE TABLE media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  poster_path TEXT,
  alt_text TEXT,
  sha256 TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
