PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  article TEXT NOT NULL,
  title TEXT NOT NULL,
  nickname TEXT NOT NULL,
  body TEXT NOT NULL,
  owner_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('published','pending','hidden')),
  created_at INTEGER NOT NULL,
  hidden_at INTEGER,
  before_hide TEXT CHECK (before_hide IN ('published','pending')),
  reply TEXT,
  replied_at INTEGER
);
CREATE INDEX IF NOT EXISTS comments_article_state ON comments(article, state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS comments_article_owner ON comments(article, owner_hash, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS comments_fingerprint ON comments(fingerprint, article);
CREATE INDEX IF NOT EXISTS comments_state_time ON comments(state, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS comments_created ON comments(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS comments_hidden ON comments(hidden_at) WHERE hidden_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('spam','abuse','removal','other')),
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS feedback_comment ON feedback(comment_id, resolved_at, created_at);
CREATE INDEX IF NOT EXISTS feedback_new ON feedback(created_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS comment_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS comment_limits_expiry ON comment_limits(expires_at);

CREATE TABLE IF NOT EXISTS comment_digests (
  day TEXT PRIMARY KEY,
  through_time INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0
);
