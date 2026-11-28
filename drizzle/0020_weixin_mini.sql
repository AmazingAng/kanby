CREATE TABLE mini_identities (
  id TEXT PRIMARY KEY NOT NULL,
  app_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE mini_pairs (
  code_hash TEXT PRIMARY KEY NOT NULL,
  app_id TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE mini_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  identity_id TEXT NOT NULL REFERENCES mini_identities(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_mini_sessions_identity ON mini_sessions(identity_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_mini_sessions_expiry ON mini_sessions(expires_at);
--> statement-breakpoint
CREATE INDEX idx_mini_pairs_expiry ON mini_pairs(expires_at);
--> statement-breakpoint
CREATE TABLE mini_limits (
  bucket TEXT PRIMARY KEY NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_mini_limits_expiry ON mini_limits(expires_at);

--> statement-breakpoint
CREATE UNIQUE INDEX idx_mini_identity_subject ON mini_identities(app_id, subject_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mini_identity_user ON mini_identities(app_id, user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_mini_pair_subject ON mini_pairs(app_id, subject_hash);
