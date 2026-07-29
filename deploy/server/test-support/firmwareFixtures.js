'use strict';

const MAC = 'AABBCCDDEEFF';

function outletsPayload(overrides = {}) {
  return {
    v: 1,
    source: 'reconnect',
    outlets: [
      { id: 4, assignment: 'Water Pump', label: 'Reservoir Pump' },
      { id: 2, assignment: 'Fan', label: 'Exhaust Fan' },
      { id: 1, assignment: 'Light', label: 'Canopy Light' },
      { id: 3, assignment: 'Fan', label: 'Circulation Fan' },
    ],
    ...overrides,
  };
}

function schedulePayload(overrides = {}) {
  return {
    active: true,
    mode: 'auto',
    source: 'reconnect',
    time_valid: true,
    time_source: 'sntp',
    sntp_status: 'synced',
    time_warning: '',
    sensor_warning: '',
    warnings: [],
    schedule: {
      v: 3,
      outlets: [
        { id: 1, conditions: [{ type: 'time_window', start: '06:00', end: '22:00' }] },
        {
          id: 4,
          conditions: [
            {
              type: 'interval',
              run_mins: 15,
              every_hrs: 4,
              window: { start: '08:00', end: '20:00' },
            },
          ],
        },
      ],
    },
    outlet_status: [1, 2, 3, 4].map((id) => ({ id, state: 'off', summary: '' })),
    ...overrides,
  };
}

module.exports = { MAC, outletsPayload, schedulePayload };
