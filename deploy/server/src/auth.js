'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createAuthEventStore, redactAuthEventsForExport } = require('./authEvents');
const { createClientIpResolver, normalizeIp } = require('./clientIp');
const {
  DUMMY_PASSWORD_VERIFIER,
  hashPassword,
  validatePassword,
  validateUsername,
  verifyPassword,
} = require('./passwordAuth');
const { createFixedWindowRateLimiter, SWEEP_INTERVAL_MS } = require('./rateLimiter');
const { SessionSecretError, createSessionSecretStore, hashToken } = require('./sessionSecret');
const { HttpError } = require('./http');

const SESSION_COOKIE = 'growhub_session';
const SESSION_LIFETIME_MS = 30 * 86_400_000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

class AuthOperationError extends HttpError {
  constructor(status, code, message, details) {
    super(status, code, message, details);
    this.name = 'AuthOperationError';
    this.expose = true;
  }
}

function parseCookie(req, name) {
  const header = req.headers.cookie;
  if (typeof header !== 'string') return null;
  const matches = [];
  for (const field of header.split(';')) {
    const separator = field.indexOf('=');
    if (separator < 1) continue;
    if (field.slice(0, separator).trim() !== name) continue;
    matches.push(field.slice(separator + 1).trim());
  }
  return matches.length === 1 ? matches[0] : null;
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left || '') || !/^[a-f0-9]{64}$/.test(right || '')) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function createAuthSystem({
  database,
  config,
  clock = () => Date.now(),
  randomBytesFn = randomBytes,
  hashPasswordFn = hashPassword,
  verifyPasswordFn = verifyPassword,
} = {}) {
  const { db, stmts } = database;
  const secretStore = createSessionSecretStore(config.appDataDir, { randomBytesFn });
  const clientIps = createClientIpResolver({ trustedProxies: config.trustedProxies, clock });
  const events = createAuthEventStore({ stmts, clock });
  const limiter = createFixedWindowRateLimiter({
    clock,
    onThrottle: (entry) => events.recordThrottle(entry),
  });

  if (stmts.getAdmin.get() && !secretStore.load()) {
    throw new SessionSecretError(
      `Admin credentials exist but ${secretStore.filename} is missing. Restore app data from a backup or intentionally reset it to run first-time setup again.`,
    );
  }
  stmts.pruneAuthSessions.run({ now: clock() });

  function setupRequired() {
    return !stmts.getAdmin.get();
  }

  function secureRequest(req) {
    if (req.socket?.encrypted) return true;
    const direct = normalizeIp(req.socket?.remoteAddress);
    return Boolean(
      direct &&
      clientIps.isTrusted(direct) &&
      typeof req.headers['x-forwarded-proto'] === 'string' &&
      req.headers['x-forwarded-proto'].trim().toLowerCase() === 'https',
    );
  }

  function cookieValue(req, value, { clear = false } = {}) {
    const fields = [
      `${SESSION_COOKIE}=${clear ? '' : value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${clear ? 0 : Math.floor(SESSION_LIFETIME_MS / 1_000)}`,
    ];
    if (secureRequest(req)) fields.push('Secure');
    return fields.join('; ');
  }

  function setSessionCookie(req, res, value) {
    res.setHeader('Set-Cookie', cookieValue(req, value));
  }

  function clearSessionCookie(req, res) {
    res.setHeader('Set-Cookie', cookieValue(req, '', { clear: true }));
  }

  function rateLimit(req, primaryCategory, secondary = null) {
    const clientIp = req.commandCenterClientIp || clientIps.resolve(req);
    req.commandCenterClientIp = clientIp;
    const result = limiter.consume({
      primary: { category: primaryCategory, key: clientIp },
      secondary,
      clientIp,
    });
    if (!result.allowed) {
      const error = new AuthOperationError(
        429,
        'rate_limited',
        'Too many attempts. Try again later.',
      );
      error.retryAfterSeconds = result.retryAfterSeconds;
      throw error;
    }
    return clientIp;
  }

  async function setup(req, { username, password, passwordConfirmation }) {
    const clientIp = rateLimit(req, 'setup_ip');
    if (!setupRequired()) {
      throw new AuthOperationError(
        409,
        'setup_complete',
        'Command Center setup is already complete.',
      );
    }

    const usernameResult = validateUsername(username);
    const passwordResult = validatePassword(password);
    if (!usernameResult.valid) {
      throw new AuthOperationError(400, 'invalid_setup', usernameResult.message, {
        field: 'username',
      });
    }
    if (!passwordResult.valid) {
      throw new AuthOperationError(400, 'invalid_setup', passwordResult.message, {
        field: 'password',
      });
    }
    if (password !== passwordConfirmation) {
      throw new AuthOperationError(400, 'invalid_setup', 'Passwords do not match.', {
        field: 'password_confirmation',
      });
    }

    const passwordVerifier = await hashPasswordFn(password);
    secretStore.ensure();
    const now = clock();
    try {
      stmts.insertAdmin.run({
        username: usernameResult.username,
        password_verifier: passwordVerifier,
        created_at: now,
        updated_at: now,
      });
    } catch (error) {
      if (error?.code?.startsWith('SQLITE_CONSTRAINT')) {
        throw new AuthOperationError(
          409,
          'setup_complete',
          'Command Center setup is already complete.',
        );
      }
      throw error;
    }
    events.record('setup_completed', {
      clientIp,
      adminIdentity: usernameResult.username,
      now,
    });
    return { username: usernameResult.username };
  }

  function createSession(username) {
    const secret = secretStore.ensure();
    const sessionId = randomBytesFn(32).toString('base64url');
    const csrfToken = randomBytesFn(32).toString('base64url');
    const now = clock();
    const expiresAt = now + SESSION_LIFETIME_MS;
    stmts.insertAuthSession.run({
      id_hash: hashToken(secret, 'session', sessionId),
      csrf_hash: hashToken(secret, 'csrf', csrfToken),
      created_at: now,
      last_seen_at: now,
      expires_at: expiresAt,
    });
    return { csrfToken, expiresAt, sessionId, username };
  }

  async function login(req, { username, password }) {
    const usernameResult = validateUsername(username);
    const clientIp = rateLimit(
      req,
      'login_ip',
      usernameResult.valid ? { category: 'login_username', key: usernameResult.username } : null,
    );
    const admin = stmts.getAdmin.get();
    const usernameMatches = Boolean(
      admin && usernameResult.valid && admin.username === usernameResult.username,
    );
    const candidatePassword =
      typeof password === 'string' && Array.from(password).length <= 128
        ? password
        : 'invalid-login-placeholder';
    const verification = await verifyPasswordFn(
      candidatePassword,
      usernameMatches ? admin.password_verifier : DUMMY_PASSWORD_VERIFIER,
    );

    if (!usernameMatches || !verification.valid) {
      throw new AuthOperationError(401, 'authentication_failed', 'Unable to sign in.');
    }

    let expectedVerifier = admin.password_verifier;
    if (verification.needsRehash) {
      const passwordVerifier = await hashPasswordFn(password);
      const update = stmts.updateAdminPassword.run({
        password_verifier: passwordVerifier,
        expected_password_verifier: admin.password_verifier,
        updated_at: clock(),
      });
      if (update.changes !== 1) {
        throw new AuthOperationError(401, 'authentication_failed', 'Unable to sign in.');
      }
      expectedVerifier = passwordVerifier;
    }

    const current = stmts.getAdmin.get();
    if (
      !current ||
      current.username !== admin.username ||
      current.password_verifier !== expectedVerifier
    ) {
      throw new AuthOperationError(401, 'authentication_failed', 'Unable to sign in.');
    }
    const session = createSession(current.username);
    events.record('login_succeeded', {
      clientIp,
      adminIdentity: current.username,
    });
    return session;
  }

  function authenticate(req, res) {
    const sessionId = parseCookie(req, SESSION_COOKIE);
    if (!sessionId || !SESSION_TOKEN_PATTERN.test(sessionId)) return null;
    const secret = secretStore.load();
    if (!secret) return null;
    const idHash = hashToken(secret, 'session', sessionId);
    const row = stmts.getAuthSession.get(idHash);
    const now = clock();
    if (!row || row.revoked_at !== null || row.expires_at <= now) {
      if (row) stmts.revokeAuthSession.run({ id_hash: idHash, revoked_at: now });
      clearSessionCookie(req, res);
      return null;
    }

    const expiresAt = now + SESSION_LIFETIME_MS;
    stmts.touchAuthSession.run({ id_hash: idHash, last_seen_at: now, expires_at: expiresAt });
    setSessionCookie(req, res, sessionId);
    return {
      adminId: row.admin_id,
      csrfHash: row.csrf_hash,
      expiresAt,
      idHash,
      sessionId,
      username: row.username,
    };
  }

  function requireAuth(req, res, next) {
    const auth = authenticate(req, res);
    if (!auth) {
      const code = setupRequired() ? 'setup_required' : 'session_required';
      const message =
        code === 'setup_required' ? 'Command Center setup is required.' : 'Sign in is required.';
      return next(new AuthOperationError(401, code, message));
    }
    req.auth = auth;
    return next();
  }

  function requireCsrf(req, _res, next) {
    const supplied = req.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || !supplied) {
      return next(new AuthOperationError(403, 'csrf_required', 'A CSRF token is required.'));
    }
    const secret = secretStore.load();
    const actual = secret ? hashToken(secret, 'csrf', supplied) : '';
    if (!safeEqualHex(actual, req.auth.csrfHash)) {
      return next(new AuthOperationError(403, 'csrf_invalid', 'The CSRF token is invalid.'));
    }
    return next();
  }

  function refreshSession(req) {
    const secret = secretStore.load();
    const csrfToken = randomBytesFn(32).toString('base64url');
    const now = clock();
    const expiresAt = now + SESSION_LIFETIME_MS;
    stmts.rotateAuthSessionCsrf.run({
      id_hash: req.auth.idHash,
      csrf_hash: hashToken(secret, 'csrf', csrfToken),
      last_seen_at: now,
      expires_at: expiresAt,
    });
    req.auth.csrfHash = hashToken(secret, 'csrf', csrfToken);
    req.auth.expiresAt = expiresAt;
    return { csrfToken, expiresAt, username: req.auth.username };
  }

  function logout(req, res) {
    const now = clock();
    const result = stmts.revokeAuthSession.run({ id_hash: req.auth.idHash, revoked_at: now });
    clearSessionCookie(req, res);
    events.record('logout', {
      clientIp: req.commandCenterClientIp || clientIps.resolve(req),
      adminIdentity: req.auth.username,
      now,
    });
    return { ended: result.changes > 0 };
  }

  async function verifyCurrentPassword(password, admin) {
    const candidate =
      typeof password === 'string' && Array.from(password).length <= 128
        ? password
        : 'invalid-login-placeholder';
    const result = await verifyPasswordFn(candidate, admin.password_verifier);
    if (!result.valid) {
      throw new AuthOperationError(
        401,
        'credential_change_failed',
        'Unable to change credentials.',
      );
    }
    return result;
  }

  async function changeUsername(req, { username, currentPassword }) {
    const clientIp = rateLimit(req, 'username_change_ip', {
      category: 'username_change_admin',
      key: String(req.auth.adminId),
    });
    const usernameResult = validateUsername(username);
    if (!usernameResult.valid) {
      throw new AuthOperationError(400, 'invalid_username', usernameResult.message, {
        field: 'username',
      });
    }
    const admin = stmts.getAdmin.get();
    const verification = await verifyCurrentPassword(currentPassword, admin);
    const now = clock();
    const replacementVerifier = verification.needsRehash
      ? await hashPasswordFn(currentPassword)
      : null;

    const transaction = db.transaction(() => {
      const update = stmts.updateAdminUsername.run({
        username: usernameResult.username,
        expected_password_verifier: admin.password_verifier,
        updated_at: now,
      });
      if (update.changes !== 1)
        throw new AuthOperationError(
          409,
          'credential_changed',
          'Credentials changed during this request.',
        );
      if (replacementVerifier) {
        stmts.updateAdminPassword.run({
          password_verifier: replacementVerifier,
          expected_password_verifier: admin.password_verifier,
          updated_at: now,
        });
      }
      return stmts.revokeAllAuthSessions.run({ revoked_at: now }).changes;
    });
    const revokedCount = transaction();
    events.record('username_changed', {
      clientIp,
      adminIdentity: usernameResult.username,
      now,
    });
    events.record('sessions_revoked', {
      clientIp,
      adminIdentity: usernameResult.username,
      reason: 'username_changed',
      now,
    });
    return { revokedCount, username: usernameResult.username };
  }

  async function changePassword(req, { currentPassword, password, passwordConfirmation }) {
    const clientIp = rateLimit(req, 'password_change_ip', {
      category: 'password_change_admin',
      key: String(req.auth.adminId),
    });
    const validation = validatePassword(password);
    if (!validation.valid) {
      throw new AuthOperationError(400, 'invalid_password', validation.message, {
        field: 'password',
      });
    }
    if (password !== passwordConfirmation) {
      throw new AuthOperationError(400, 'invalid_password', 'Passwords do not match.', {
        field: 'password_confirmation',
      });
    }
    const admin = stmts.getAdmin.get();
    await verifyCurrentPassword(currentPassword, admin);
    const passwordVerifier = await hashPasswordFn(password);
    const now = clock();
    const transaction = db.transaction(() => {
      const update = stmts.updateAdminPassword.run({
        password_verifier: passwordVerifier,
        expected_password_verifier: admin.password_verifier,
        updated_at: now,
      });
      if (update.changes !== 1)
        throw new AuthOperationError(
          409,
          'credential_changed',
          'Credentials changed during this request.',
        );
      return stmts.revokeAllAuthSessions.run({ revoked_at: now }).changes;
    });
    const revokedCount = transaction();
    events.record('password_changed', {
      clientIp,
      adminIdentity: admin.username,
      now,
    });
    events.record('sessions_revoked', {
      clientIp,
      adminIdentity: admin.username,
      reason: 'password_changed',
      now,
    });
    return { revokedCount, username: admin.username };
  }

  function diagnostics({ exported = false } = {}) {
    const authEvents = events.list();
    return Object.freeze({
      rate_limiting: limiter.snapshot(),
      trusted_proxies: clientIps.snapshot({ redactEntries: exported }),
      auth_security_events: exported ? redactAuthEventsForExport(authEvents) : authEvents,
    });
  }

  return Object.freeze({
    authenticate,
    changePassword,
    changeUsername,
    clearSessionCookie,
    diagnostics,
    limiter,
    login,
    logout,
    refreshSession,
    requireAuth,
    requireCsrf,
    setSessionCookie,
    setup,
    setupRequired,
  });
}

module.exports = {
  AuthOperationError,
  SESSION_COOKIE,
  SESSION_LIFETIME_MS,
  SWEEP_INTERVAL_MS,
  createAuthSystem,
};
