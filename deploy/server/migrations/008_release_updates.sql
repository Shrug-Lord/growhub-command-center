ALTER TABLE command_center_update_state ADD COLUMN checks_enabled INTEGER NOT NULL DEFAULT 0 CHECK(checks_enabled IN (0,1));
ALTER TABLE command_center_update_state ADD COLUMN later_tag TEXT;
ALTER TABLE command_center_update_state ADD COLUMN later_until INTEGER;
UPDATE command_center_update_state SET auto_install = 0;
CREATE TABLE device_update_state (
 device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
 state_json TEXT NOT NULL,
 received_at INTEGER NOT NULL
);
