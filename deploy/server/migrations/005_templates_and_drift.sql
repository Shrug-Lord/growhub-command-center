CREATE TABLE schedule_template_revisions (
  id            TEXT PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
  revision      INTEGER NOT NULL CHECK (revision > 0),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  roles_json    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  UNIQUE (template_id, revision)
);

CREATE INDEX idx_schedule_template_revisions_template
  ON schedule_template_revisions (template_id, revision DESC);

CREATE TABLE device_setup_reviews (
  device_id          TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  outlet_fingerprint TEXT NOT NULL,
  reviewed_at        INTEGER NOT NULL,
  action_id          TEXT NOT NULL REFERENCES device_actions(id) ON DELETE RESTRICT
);

CREATE TABLE schedule_drift_episodes (
  id                    TEXT PRIMARY KEY,
  device_id             TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  detection_event_id    TEXT NOT NULL REFERENCES device_events(id) ON DELETE RESTRICT,
  expected_fingerprint  TEXT NOT NULL,
  reason                TEXT NOT NULL CHECK (reason IN (
    'firmware_schedule_cleared', 'outlet_assignment_changed',
    'schedule_body_changed', 'unknown_firmware_change'
  )),
  started_at            INTEGER NOT NULL,
  resolved_at           INTEGER,
  resolution            TEXT CHECK (resolution IS NULL OR resolution IN (
    'loaded_expected_schedule', 'adopted_firmware_schedule',
    'firmware_returned_to_expected', 'acknowledged_drift'
  )),
  reconciliation_event_id TEXT REFERENCES device_events(id) ON DELETE RESTRICT,
  CHECK ((resolved_at IS NULL) = (resolution IS NULL)),
  CHECK (resolved_at IS NULL OR resolved_at >= started_at)
);

CREATE UNIQUE INDEX idx_schedule_drift_episodes_active
  ON schedule_drift_episodes (device_id)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_schedule_drift_episodes_history
  ON schedule_drift_episodes (device_id, started_at DESC);

ALTER TABLE device_expected_schedules ADD COLUMN template_revision_id TEXT
  REFERENCES schedule_template_revisions(id) ON DELETE SET NULL;
ALTER TABLE device_expected_schedules ADD COLUMN expected_fingerprint TEXT;
ALTER TABLE device_expected_schedules ADD COLUMN source_action_id TEXT
  REFERENCES device_actions(id) ON DELETE SET NULL;
