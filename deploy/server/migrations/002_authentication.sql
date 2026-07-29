CREATE TABLE admin_credentials (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  username          TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_verifier TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id_hash     TEXT PRIMARY KEY CHECK (length(id_hash) = 64),
  admin_id    INTEGER NOT NULL REFERENCES admin_credentials(id) ON DELETE CASCADE,
  csrf_hash   TEXT NOT NULL CHECK (length(csrf_hash) = 64),
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  CHECK (expires_at >= created_at)
);

CREATE INDEX idx_auth_sessions_expiry
  ON auth_sessions (expires_at);

CREATE TABLE auth_security_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL CHECK (type IN (
    'setup_completed', 'login_succeeded', 'logout',
    'username_changed', 'password_changed', 'sessions_revoked',
    'rate_limit_throttled'
  )),
  client_ip      TEXT,
  admin_identity TEXT,
  category       TEXT CHECK (category IS NULL OR category IN (
    'setup_ip', 'login_ip', 'login_username',
    'username_change_ip', 'username_change_admin',
    'password_change_ip', 'password_change_admin'
  )),
  reason         TEXT,
  first_at       INTEGER NOT NULL,
  last_at        INTEGER NOT NULL,
  count          INTEGER NOT NULL DEFAULT 1 CHECK (count > 0),
  CHECK (last_at >= first_at)
);

CREATE INDEX idx_auth_security_events_recency
  ON auth_security_events (last_at DESC, id DESC);

CREATE INDEX idx_auth_security_events_throttle
  ON auth_security_events (type, client_ip, category, last_at DESC);
