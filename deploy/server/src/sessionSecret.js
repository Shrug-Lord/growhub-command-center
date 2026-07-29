'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_SECRET_FILE = 'session-secret';

class SessionSecretError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'SessionSecretError';
    this.code = 'invalid_session_secret';
    this.expose = true;
  }
}

function decodeSecret(contents, filename) {
  const encoded = String(contents).trim();
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new SessionSecretError(`Session secret at ${filename} is malformed.`);
  }
  const secret = Buffer.from(encoded, 'base64url');
  if (secret.length !== 32) {
    throw new SessionSecretError(`Session secret at ${filename} must contain 32 bytes.`);
  }
  return secret;
}

function createSessionSecretStore(
  appDataDir,
  { fileSystem = fs, randomBytesFn = crypto.randomBytes } = {},
) {
  const filename = path.join(appDataDir, SESSION_SECRET_FILE);
  let cached;

  function load() {
    if (cached) return cached;
    try {
      cached = decodeSecret(fileSystem.readFileSync(filename, 'utf8'), filename);
      try {
        fileSystem.chmodSync(filename, 0o600);
      } catch (_) {}
      return cached;
    } catch (error) {
      if (error instanceof SessionSecretError || error?.code !== 'ENOENT') throw error;
      return null;
    }
  }

  function ensure() {
    const existing = load();
    if (existing) return existing;

    fileSystem.mkdirSync(appDataDir, { recursive: true });
    const generated = randomBytesFn(32);
    if (!Buffer.isBuffer(generated) || generated.length !== 32) {
      throw new SessionSecretError('Session secret generator did not return 32 bytes.');
    }

    let descriptor;
    try {
      descriptor = fileSystem.openSync(filename, 'wx', 0o600);
      fileSystem.writeFileSync(descriptor, `${generated.toString('base64url')}\n`, 'utf8');
      fileSystem.fsyncSync?.(descriptor);
      fileSystem.closeSync(descriptor);
      descriptor = undefined;
      try {
        fileSystem.chmodSync(filename, 0o600);
      } catch (_) {}
      cached = generated;
      return cached;
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          fileSystem.closeSync(descriptor);
        } catch (_) {}
      }
      if (error?.code === 'EEXIST') return load();
      throw new SessionSecretError(`Unable to create session secret in ${appDataDir}.`, error);
    }
  }

  return Object.freeze({ filename, ensure, load });
}

function hashToken(secret, purpose, token) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${purpose}\0`, 'utf8')
    .update(token, 'utf8')
    .digest('hex');
}

module.exports = {
  SESSION_SECRET_FILE,
  SessionSecretError,
  createSessionSecretStore,
  hashToken,
};
