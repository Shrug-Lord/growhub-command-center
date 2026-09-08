'use strict';
const { randomUUID } = require('node:crypto');
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)C$/;
const STAGES = [
  'idle',
  'checking',
  'check_failed',
  'downloading',
  'restarting',
  'installed',
  'failed',
  'unavailable',
];
function normalizeUpdate(value) {
  if (!value || value.v !== 1 || !STAGES.includes(value.stage))
    throw new Error('Invalid firmware update state');
  for (const key of ['checks_enabled', 'available', 'prompt'])
    if (typeof value[key] !== 'boolean') throw new Error('Invalid update flag');
  for (const key of ['tag', 'target_tag'])
    if (typeof value[key] !== 'string' || (value[key] && !TAG.test(value[key])))
      throw new Error('Invalid release tag');
  for (const key of ['checked_at', 'bytes', 'size'])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0)
      throw new Error('Invalid update progress');
  if (
    typeof value.current_version !== 'string' ||
    value.current_version.length > 32 ||
    typeof value.error !== 'string' ||
    value.error.length > 200 ||
    typeof value.action_id !== 'string' ||
    value.action_id.length > 64
  )
    throw new Error('Invalid update metadata');
  return {
    v: 1,
    checks_enabled: value.checks_enabled,
    available: value.available,
    prompt: value.prompt,
    tag: value.tag,
    target_tag: value.target_tag,
    current_version: value.current_version,
    stage: value.stage,
    error: value.error,
    action_id: value.action_id,
    checked_at: value.checked_at,
    bytes: value.bytes,
    size: value.size,
    release_url: value.tag
      ? 'https://github.com/Shrug-Lord/growhub-ce-firmware/releases/tag/' + value.tag
      : '',
  };
}
function prepareUpdateAction(body, current) {
  if (!current || !['check', 'settings', 'later', 'skip', 'install'].includes(body?.op))
    throw new Error('Firmware update action unavailable');
  if (['checking', 'downloading', 'restarting'].includes(current.stage))
    throw new Error('Firmware updater is busy');
  const result = { v: 1, id: randomUUID(), op: body.op };
  if (body.op === 'settings') {
    if (typeof body.enabled !== 'boolean') throw new Error('checks_enabled must be boolean');
    result.enabled = body.enabled;
  }
  if (['later', 'skip', 'install'].includes(body.op)) {
    if (!current.available || !TAG.test(body.tag) || body.tag !== current.tag)
      throw new Error('Release changed; refresh before continuing');
    result.tag = body.tag;
  }
  if (body.op === 'install') {
    if (body.confirmed !== true) throw new Error('Confirm the target version and restart impact');
    result.confirmed = true;
  }
  return result;
}
module.exports = { normalizeUpdate, prepareUpdateAction };
