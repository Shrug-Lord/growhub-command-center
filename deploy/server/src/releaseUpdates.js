'use strict';

const fs = require('node:fs');
const path = require('node:path');
const serverPackage = require('../package.json');

const RELEASE_API_URL =
  'https://api.github.com/repos/Shrug-Lord/growhub-command-center/releases/latest';
const RELEASE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const RELEASE_CHECK_TIMEOUT_MS = 8_000;
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

class ReleaseUpdateError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ReleaseUpdateError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseVersion(value) {
  const match = RELEASE_TAG.exec(`v${String(value).replace(/^v/, '')}`);
  const parts = match ? match.slice(1).map(Number) : null;
  return parts?.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function normalizeRelease(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    value.draft === true ||
    value.prerelease === true ||
    !RELEASE_TAG.test(value.tag_name) ||
    typeof value.html_url !== 'string' ||
    value.html_url !==
      `https://github.com/Shrug-Lord/growhub-command-center/releases/tag/${value.tag_name}`
  ) {
    throw new Error('The repository returned an invalid latest release.');
  }
  return {
    tag: value.tag_name,
    version: value.tag_name.slice(1),
    name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : value.tag_name,
    url: value.html_url,
    published_at:
      typeof value.published_at === 'string' && Number.isFinite(Date.parse(value.published_at))
        ? new Date(value.published_at).toISOString()
        : null,
  };
}

function readJsonFile(file) {
  try {
    return parseJson(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

function writeJsonAtomic(directory, filename, value) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const target = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${process.pid}.${Date.now()}.tmp`);
  // The container writes this non-secret request as root; the unprivileged host
  // updater must be able to read and unlink it from the operator-owned directory.
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporary, target);
}

function createReleaseUpdateService({
  database,
  logger,
  updateRequestDir,
  clock = () => Date.now(),
  fetchFn = globalThis.fetch,
  currentVersion = serverPackage.version,
  checkIntervalMs = RELEASE_CHECK_INTERVAL_MS,
  checkTimeoutMs = RELEASE_CHECK_TIMEOUT_MS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const { db } = database;
  const oldRequest = readJsonFile(path.join(updateRequestDir, 'request.json'));
  if (oldRequest && (oldRequest.requested_by !== 'user' || oldRequest.confirmed !== true)) {
    fs.unlinkSync(path.join(updateRequestDir, 'request.json'));
    db.prepare(
      'UPDATE command_center_update_state SET last_requested_tag = NULL WHERE singleton = 1',
    ).run();
  }
  const sql = {
    get: db.prepare('SELECT * FROM command_center_update_state WHERE singleton = 1'),
    cacheCheck: db.prepare(`
      UPDATE command_center_update_state
      SET cached_release_json = @cached_release_json, last_checked_at = @last_checked_at,
          last_check_error = NULL, updated_at = @last_checked_at
      WHERE singleton = 1
    `),
    recordCheckError: db.prepare(`
      UPDATE command_center_update_state
      SET last_checked_at = @last_checked_at, last_check_error = @last_check_error,
          updated_at = @last_checked_at
      WHERE singleton = 1
    `),
    dismiss: db.prepare(`
      UPDATE command_center_update_state
      SET dismissed_tag = @tag, updated_at = @updated_at WHERE singleton = 1
    `),
    setChecksEnabled: db.prepare(`
      UPDATE command_center_update_state
      SET checks_enabled = @checks_enabled, auto_install = 0,
          updated_at = @updated_at
      WHERE singleton = 1
    `),
    markRequested: db.prepare(`
      UPDATE command_center_update_state
      SET last_requested_tag = @tag, updated_at = @updated_at WHERE singleton = 1
    `),
  };
  let intervalHandle = null;
  let nextBackground = clock() + Math.floor(Math.random() * 60_000);
  let inFlight = null;
  let activeController = null;
  let closed = false;

  function agentState() {
    const agent = readJsonFile(path.join(updateRequestDir, 'agent.json'));
    const request = readJsonFile(path.join(updateRequestDir, 'request.json'));
    const result = readJsonFile(path.join(updateRequestDir, 'status.json'));
    return {
      installed: agent?.v === 1 && agent?.installed === true,
      installed_at: agent?.installed_at ?? null,
      request:
        request?.v === 1
          ? { state: 'requested', tag: request.tag, requested_at: request.requested_at }
          : result?.v === 1
            ? {
                state: result.state,
                tag: result.tag,
                requested_at: result.requested_at ?? null,
                completed_at: result.completed_at ?? null,
                message: result.message ?? null,
              }
            : null,
    };
  }

  function status() {
    const row = sql.get.get();
    const release = parseJson(row.cached_release_json);
    const available = Boolean(release && compareVersions(release.version, currentVersion) === 1);
    const agent = agentState();
    const requested =
      agent.request && agent.request.tag === release?.tag
        ? agent.request
        : row.last_requested_tag === release?.tag
          ? { state: 'requested', tag: release.tag, requested_at: null }
          : null;
    const dismissed = available && row.dismissed_tag === release.tag;
    const deferred = row.later_tag === release?.tag && row.later_until > clock();
    return {
      current_version: currentVersion,
      latest_release: release,
      update_available: available,
      prompt_available: available && !dismissed && !deferred && !requested,
      dismissed,
      checks_enabled: row.checks_enabled === 1,
      deferred,
      checked_at: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
      check_error: row.last_check_error,
      agent: {
        installed: agent.installed,
        installed_at: agent.installed_at,
      },
      install: requested,
    };
  }

  function requestInstall(tag, confirmed = false) {
    const current = status();
    if (!current.update_available || current.latest_release?.tag !== tag) {
      throw new ReleaseUpdateError(409, 'update_not_available', 'That release is not available.');
    }
    if (!current.agent.installed) {
      throw new ReleaseUpdateError(
        409,
        'update_agent_unavailable',
        'The Pi update service must be installed once before Command Center can apply updates.',
      );
    }
    if (confirmed !== true)
      throw new ReleaseUpdateError(
        400,
        'confirmation_required',
        'Confirm the version and restart impact before updating.',
      );
    const active = agentState().request;
    if (active && ['requested', 'installing'].includes(active.state))
      throw new ReleaseUpdateError(409, 'update_busy', 'An installation is already in progress.');
    const requestedAt = new Date(clock()).toISOString();
    writeJsonAtomic(updateRequestDir, 'request.json', {
      v: 1,
      tag,
      version: current.latest_release.version,
      release_url: current.latest_release.url,
      requested_at: requestedAt,
      requested_by: 'user',
      confirmed: true,
    });
    sql.markRequested.run({ tag, updated_at: clock() });
    logger.info('command_center_update_requested', { tag, requested_by: 'user', confirmed: true });
    return status();
  }

  async function performCheck() {
    const checkedAt = clock();
    const controller = new AbortController();
    activeController = controller;
    const timeout = setTimeout(() => controller.abort(), checkTimeoutMs);
    timeout.unref?.();
    try {
      const response = await fetchFn(RELEASE_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `growhub-command-center/${currentVersion}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
      const release = normalizeRelease(await response.json());
      if (closed) return null;
      sql.cacheCheck.run({
        cached_release_json: JSON.stringify(release),
        last_checked_at: checkedAt,
      });
      return status();
    } catch (error) {
      if (closed) return null;
      const message = error?.name === 'AbortError' ? 'Release check timed out.' : error.message;
      sql.recordCheckError.run({ last_checked_at: checkedAt, last_check_error: message });
      logger.warn('command_center_release_check_failed', { error });
      return status();
    } finally {
      clearTimeout(timeout);
      if (activeController === controller) activeController = null;
    }
  }

  function check({ force = false } = {}) {
    const row = sql.get.get();
    if (!force && !row.checks_enabled) return Promise.resolve(status());
    if (!force && row.last_checked_at && clock() - row.last_checked_at < checkIntervalMs) {
      return Promise.resolve(status());
    }
    if (!inFlight) {
      inFlight = performCheck().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function dismiss(tag, mode = 'skip') {
    const current = status();
    if (!current.update_available || current.latest_release?.tag !== tag) {
      throw new ReleaseUpdateError(409, 'update_not_available', 'That release is not available.');
    }
    if (!['skip', 'later'].includes(mode))
      throw new ReleaseUpdateError(400, 'invalid_dismissal', 'Choose Later or Skip this version.');
    if (mode === 'later')
      db.prepare(
        'UPDATE command_center_update_state SET later_tag = ?, later_until = ? WHERE singleton = 1',
      ).run(tag, clock() + 86_400_000);
    else sql.dismiss.run({ tag, updated_at: clock() });
    return status();
  }

  async function setChecksEnabled(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new ReleaseUpdateError(
        400,
        'invalid_update_settings',
        'checks_enabled must be true or false.',
      );
    }
    sql.setChecksEnabled.run({ checks_enabled: enabled ? 1 : 0, updated_at: clock() });
    nextBackground = clock() + Math.floor(Math.random() * 60_000);
    return status();
  }

  function start() {
    closed = false;
    intervalHandle = setIntervalFn(() => {
      if (!sql.get.get().checks_enabled || clock() < nextBackground) return;
      nextBackground = clock() + checkIntervalMs + Math.floor(Math.random() * 60_000);
      void check({ force: true });
    }, 1000);
    intervalHandle?.unref?.();
  }

  function close() {
    closed = true;
    activeController?.abort();
    activeController = null;
    if (intervalHandle) clearIntervalFn(intervalHandle);
    intervalHandle = null;
  }

  return {
    check,
    close,
    dismiss,
    requestInstall,
    setChecksEnabled,
    start,
    status,
  };
}

module.exports = {
  RELEASE_API_URL,
  RELEASE_CHECK_INTERVAL_MS,
  ReleaseUpdateError,
  compareVersions,
  createReleaseUpdateService,
  normalizeRelease,
};
