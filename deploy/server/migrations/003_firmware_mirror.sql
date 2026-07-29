ALTER TABLE devices ADD COLUMN presence_status TEXT
  CHECK (presence_status IS NULL OR presence_status IN ('online', 'offline'));
ALTER TABLE devices ADD COLUMN presence_received_at INTEGER;
ALTER TABLE devices ADD COLUMN current_mode TEXT
  CHECK (current_mode IS NULL OR current_mode IN ('auto', 'manual'));

CREATE INDEX idx_devices_presence
  ON devices (presence_status, presence_received_at DESC);

CREATE INDEX idx_devices_mode
  ON devices (current_mode);

CREATE TABLE device_state_mirrors (
  device_id             TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  state_key             TEXT NOT NULL CHECK (state_key IN (
    'presence_state', 'sensor_state', 'outlet_state', 'schedule_state'
  )),
  schema_version        INTEGER,
  normalized_json       TEXT,
  raw_json              TEXT NOT NULL,
  received_at           INTEGER NOT NULL,
  revision              INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  mqtt_retained         INTEGER NOT NULL CHECK (mqtt_retained IN (0, 1)),
  compatible            INTEGER NOT NULL CHECK (compatible IN (0, 1)),
  compatibility_reason  TEXT,
  PRIMARY KEY (device_id, state_key)
);

CREATE INDEX idx_device_state_mirrors_received
  ON device_state_mirrors (received_at DESC);

CREATE TABLE device_error_mirrors (
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  error_key       TEXT NOT NULL CHECK (error_key IN (
    'schedule_error', 'outlet_error', 'time_error', 'control_error'
  )),
  normalized_json TEXT NOT NULL,
  raw_json        TEXT NOT NULL,
  received_at     INTEGER NOT NULL,
  sequence        INTEGER NOT NULL DEFAULT 1 CHECK (sequence > 0),
  PRIMARY KEY (device_id, error_key)
);

CREATE INDEX idx_device_error_mirrors_received
  ON device_error_mirrors (received_at DESC);

CREATE TABLE retained_state_incidents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  state_key    TEXT NOT NULL CHECK (state_key IN (
    'presence_state', 'outlet_state', 'schedule_state'
  )),
  started_at   INTEGER NOT NULL,
  escalated_at INTEGER NOT NULL,
  resolved_at  INTEGER,
  CHECK (escalated_at >= started_at),
  CHECK (resolved_at IS NULL OR resolved_at >= escalated_at)
);

CREATE UNIQUE INDEX idx_retained_state_incidents_active
  ON retained_state_incidents (device_id, state_key)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_retained_state_incidents_history
  ON retained_state_incidents (device_id, resolved_at DESC, id DESC);
