CREATE TABLE IF NOT EXISTS ai_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  can_read INTEGER NOT NULL DEFAULT 1,
  can_create INTEGER NOT NULL DEFAULT 1,
  can_update INTEGER NOT NULL DEFAULT 1,
  can_archive INTEGER NOT NULL DEFAULT 0,
  can_delete INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  booking_id TEXT,
  actor_type TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE bookings ADD COLUMN archived_at TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_booking ON audit_log(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_name, created_at DESC);
