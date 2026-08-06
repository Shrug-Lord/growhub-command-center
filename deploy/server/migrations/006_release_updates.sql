CREATE TABLE command_center_update_state (
  singleton            INTEGER PRIMARY KEY CHECK (singleton = 1),
  auto_install         INTEGER NOT NULL DEFAULT 0 CHECK (auto_install IN (0, 1)),
  dismissed_tag        TEXT,
  cached_release_json  TEXT,
  last_checked_at      INTEGER,
  last_check_error     TEXT,
  last_requested_tag   TEXT,
  updated_at           INTEGER NOT NULL
);

INSERT INTO command_center_update_state (singleton, updated_at) VALUES (1, 0);
