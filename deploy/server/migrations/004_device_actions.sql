CREATE TABLE device_actions (
  id                         TEXT PRIMARY KEY,
  device_id                  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type                       TEXT NOT NULL CHECK (type IN (
    'load_schedule', 'reload_expected_schedule', 'save_as_new_template',
    'acknowledge_drift', 'update_outlet_config', 'repair_outlet_label',
    'acknowledge_label_drift', 'confirm_device_setup', 'sync_time',
    'switch_to_manual', 'return_to_auto', 'set_manual_outlet_state',
    'emergency_all_off', 'run_water_pump_now'
  )),
  status                     TEXT NOT NULL CHECK (status IN (
    'pending', 'completed', 'rejected', 'timed_out', 'interrupted', 'blocked'
  )),
  reason_code                TEXT,
  context_json               TEXT NOT NULL DEFAULT '{}',
  input_json                 TEXT NOT NULL DEFAULT '{}',
  confirmation_json          TEXT,
  required_state_keys_json   TEXT NOT NULL DEFAULT '[]',
  base_state_revisions_json  TEXT NOT NULL DEFAULT '{}',
  base_error_sequences_json  TEXT NOT NULL DEFAULT '{}',
  request_id                 TEXT,
  publish_topic              TEXT,
  publish_state              TEXT NOT NULL DEFAULT 'not_applicable' CHECK (publish_state IN (
    'not_applicable', 'prepared', 'submitted', 'acknowledged', 'failed'
  )),
  submitted_at               INTEGER,
  acknowledged_at            INTEGER,
  timeout_at                 INTEGER,
  completed_at               INTEGER,
  created_at                 INTEGER NOT NULL,
  updated_at                 INTEGER NOT NULL,
  CHECK (
    (status = 'pending' AND completed_at IS NULL AND reason_code IS NULL)
    OR
    (status != 'pending' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX idx_device_actions_device_history
  ON device_actions (device_id, created_at DESC, id DESC);

CREATE INDEX idx_device_actions_pending
  ON device_actions (device_id, timeout_at)
  WHERE status = 'pending';

CREATE TABLE device_events (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN (
    'schedule_drift_detected', 'schedule_drift_reconciled'
  )),
  context_json TEXT NOT NULL DEFAULT '{}',
  occurred_at  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_device_events_device_history
  ON device_events (device_id, occurred_at DESC, id DESC);
