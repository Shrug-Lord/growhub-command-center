CREATE TABLE grows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX idx_grows_one_active ON grows(device_id) WHERE ended_at IS NULL;
CREATE INDEX idx_grows_device_time ON grows(device_id, started_at DESC, id DESC);

ALTER TABLE grow_events ADD COLUMN grow_id INTEGER REFERENCES grows(id) ON DELETE RESTRICT;
CREATE INDEX idx_grow_events_grow_time ON grow_events(grow_id, occurred_at, id);

CREATE TABLE grow_prompts (
  action_id TEXT PRIMARY KEY REFERENCES device_actions(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL,
  confirmed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'logged', 'dismissed'))
);
CREATE INDEX idx_grow_prompts_pending ON grow_prompts(device_id, confirmed_at)
  WHERE status = 'pending';

CREATE TABLE device_network_state (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  http_port INTEGER NOT NULL CHECK (http_port BETWEEN 1 AND 65535),
  received_at INTEGER NOT NULL
);

CREATE TABLE operational_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_operational_events_device_time
  ON operational_events(device_id, occurred_at DESC, id DESC);

INSERT INTO operational_events (id, device_id, type, context_json, occurred_at, created_at)
SELECT 'legacy:' || id, device_id, type,
  json_object('label', label, 'template_id', template_id, 'notes', notes),
  occurred_at, created_at
FROM grow_events
WHERE device_id IS NOT NULL
  AND type IN ('schedule_loaded', 'schedule_removed', 'device_online', 'device_offline');
