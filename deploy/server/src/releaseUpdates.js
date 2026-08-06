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
  return match ? match.slice(1).map(Number) : null;
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
    !value.html_url.startsWith('https://github.com/Shrug-Lord/growhub-command-center/releases/tag/')
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
    setAutoInstall: db.prepare(`
      UPDATE command_center_update_state
      SET auto_install = @auto_install,
          dismissed_tag = CASE WHEN @auto_install = 1 THEN NULL ELSE dismissed_tag END,
          updated_at = @updated_at
      WHERE singleton = 1
    `),
    markRequested: db.prepare(`
      UPDATE command_center_update_state
      SET last_requested_tag = @tag, updated_at = @updated_at WHERE singleton = 1
    `),
  };
  let intervalHandle = null;
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
    const autoInstall = row.auto_install === 1;
    return {
      current_version: currentVersion,
      latest_release: release,
      update_available: available,
      prompt_available: available && !dismissed && !autoInstall && !requested,
      dismissed,
      auto_install: autoInstall,
      checked_at: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
      check_error: row.last_check_error,
      agent: {
        installed: agent.installed,
        installed_at: agent.installed_at,
      },
      install: requested,
    };
  }

  function requestInstall(tag, requestedBy = 'user', { allowRepeat = true } = {}) {
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
    if (!allowRepeat && current.install?.tag === tag) return current;
    const requestedAt = new Date(clock()).toISOString();
    writeJsonAtomic(updateRequestDir, 'request.json', {
      v: 1,
      tag,
      version: current.latest_release.version,
      release_url: current.latest_release.url,
      requested_at: requestedAt,
      requested_by: requestedBy,
    });
    sql.markRequested.run({ tag, updated_at: clock() });
    logger.info('command_center_update_requested', { tag, requested_by: requestedBy });
    return status();
  }

  function maybeRequestAutomatic() {
    const current = status();
    if (
      current.auto_install &&
      current.update_available &&
      current.agent.installed &&
      !current.install
    ) {
      return requestInstall(current.latest_release.tag, 'automatic', { allowRepeat: false });
    }
    return current;
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
      return maybeRequestAutomatic();
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
    if (!force && row.last_checked_at && clock() - row.last_checked_at < checkIntervalMs) {
      return Promise.resolve(maybeRequestAutomatic());
    }
    if (!inFlight) {
      inFlight = performCheck().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function dismiss(tag) {
    const current = status();
    if (!current.update_available || current.latest_release?.tag !== tag) {
      throw new ReleaseUpdateError(409, 'update_not_available', 'That release is not available.');
    }
    sql.dismiss.run({ tag, updated_at: clock() });
    return status();
  }

  async function setAutoInstall(enabled) {
    if (typeof enabled !== 'boolean') {
      throw new ReleaseUpdateError(
        400,
        'invalid_update_settings',
        'auto_install must be true or false.',
      );
    }
    sql.setAutoInstall.run({ auto_install: enabled ? 1 : 0, updated_at: clock() });
    return maybeRequestAutomatic();
  }

  function start() {
    closed = false;
    void check({ force: false });
    intervalHandle = setIntervalFn(() => void check({ force: true }), checkIntervalMs);
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
    setAutoInstall,
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
