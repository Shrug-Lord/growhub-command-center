CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE devices (
  id               TEXT PRIMARY KEY,
  display_name     TEXT,
  reported_name    TEXT,
  ip_address       TEXT,
  firmware_version TEXT,
  last_seen_at     INTEGER,
  outlet_state_json TEXT,
  hidden           INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_devices_last_seen
  ON devices (last_seen_at DESC);

CREATE TABLE sensor_measurements (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  observed_at      INTEGER NOT NULL,
  temperature_c    REAL,
  humidity_rh      REAL,
  light_level      INTEGER,
  co2_ppm          INTEGER,
  actuator_summary TEXT,
  firmware_version TEXT
);

CREATE INDEX idx_sensor_measurements_device_time
  ON sensor_measurements (device_id, observed_at);

CREATE TABLE device_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id       TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type            TEXT NOT NULL,
  message         TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'warning',
  acknowledged_at INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_device_alerts_open
  ON device_alerts (device_id, acknowledged_at);

CREATE TABLE schedule_templates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'load_ready')),
  editor_state_json TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE schedule_template_roles (
  id          TEXT PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
  assignment  TEXT NOT NULL CHECK (assignment IN (
    'Light', 'Fan', 'Humidifier', 'Dehumidifier',
    'Water Pump', 'Heater', 'AC Controller'
  )),
  label       TEXT NOT NULL CHECK (length(trim(label)) > 0),
  position    INTEGER NOT NULL CHECK (position >= 0),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (id, template_id),
  UNIQUE (template_id, assignment, label)
);

CREATE INDEX idx_schedule_template_roles_order
  ON schedule_template_roles (template_id, position);

CREATE TABLE schedule_role_conditions (
  id             TEXT PRIMARY KEY,
  role_id        TEXT NOT NULL REFERENCES schedule_template_roles(id) ON DELETE CASCADE,
  condition_type TEXT NOT NULL,
  condition_json TEXT NOT NULL,
  position       INTEGER NOT NULL CHECK (position >= 0),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX idx_schedule_role_conditions_order
  ON schedule_role_conditions (role_id, position);

CREATE TABLE device_role_mappings (
  template_id            INTEGER NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
  role_id                TEXT NOT NULL,
  device_id              TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  outlet_id              INTEGER NOT NULL CHECK (outlet_id BETWEEN 1 AND 4),
  assignment_snapshot    TEXT NOT NULL,
  expected_label_snapshot TEXT NOT NULL,
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (role_id, device_id),
  UNIQUE (template_id, device_id, outlet_id),
  FOREIGN KEY (role_id, template_id)
    REFERENCES schedule_template_roles(id, template_id) ON DELETE CASCADE
);

CREATE TABLE device_active_schedule_mirrors (
  device_id             TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  matched_template_id   INTEGER REFERENCES schedule_templates(id) ON DELETE SET NULL,
  matched_template_name TEXT,
  editor_snapshot_json  TEXT,
  active_schedule_json  TEXT NOT NULL,
  source                TEXT,
  observed_at           INTEGER NOT NULL
);

CREATE TABLE device_expected_schedules (
  device_id            TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  template_id          INTEGER REFERENCES schedule_templates(id) ON DELETE SET NULL,
  template_name        TEXT NOT NULL,
  template_revision    INTEGER NOT NULL CHECK (template_revision > 0),
  expected_schedule_json TEXT NOT NULL,
  role_mapping_json    TEXT NOT NULL,
  established_at       INTEGER NOT NULL
);

CREATE TABLE grow_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id   TEXT REFERENCES devices(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES schedule_templates(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  phase       TEXT,
  label       TEXT NOT NULL,
  notes       TEXT,
  occurred_at INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_grow_events_device_time
  ON grow_events (device_id, occurred_at);

INSERT INTO app_settings (key, value) VALUES
  ('retention_days', '365'),
  ('alarm_temp_high', '32'),
  ('alarm_temp_low', '15'),
  ('alarm_humidity_high', '85'),
  ('alarm_humidity_low', '35');
