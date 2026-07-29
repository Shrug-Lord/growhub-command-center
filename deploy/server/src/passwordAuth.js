'use strict';

const { argon2, randomBytes, timingSafeEqual } = require('node:crypto');

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const CURRENT_PARAMETERS = Object.freeze({
  version: 19,
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
  saltLength: 16,
});

const DUMMY_PASSWORD_VERIFIER =
  '$argon2id$v=19$m=19456,t=2,p=1$R3Jvd2h1YkR1bW15U2FsdA$wcV0kmx7nAQ7nVvaIXqBK7D7ZPIQiuZhxr8Zxrih99I';

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function validateUsername(value) {
  const username = normalizeUsername(value);
  if (!username || !USERNAME_PATTERN.test(username)) {
    return {
      valid: false,
      username,
      message: 'Username must be 3-32 characters using letters, numbers, ., _, or -.',
    };
  }
  return { valid: true, username, message: null };
}

function passwordLength(value) {
  return typeof value === 'string' ? Array.from(value).length : 0;
}

function validatePassword(value) {
  const length = passwordLength(value);
  if (length < 12 || length > 128 || /^\s*$/u.test(value)) {
    return {
      valid: false,
      message: 'Password must be 12-128 characters and cannot be all whitespace.',
    };
  }
  return { valid: true, message: null };
}

function deriveArgon2(message, nonce, parameters, argon2Fn = argon2) {
  return new Promise((resolve, reject) => {
    argon2Fn(
      'argon2id',
      {
        message,
        nonce,
        parallelism: parameters.parallelism,
        tagLength: parameters.tagLength,
        memory: parameters.memory,
        passes: parameters.passes,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function encodeVerifier(parameters, salt, derivedKey) {
  return [
    '$argon2id',
    `v=${parameters.version}`,
    `m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}`,
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

function parseVerifier(verifier) {
  if (typeof verifier !== 'string') return null;
  const match =
    /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
      verifier,
    );
  if (!match) return null;

  const parameters = {
    version: Number(match[1]),
    memory: Number(match[2]),
    passes: Number(match[3]),
    parallelism: Number(match[4]),
  };
  const salt = Buffer.from(match[5], 'base64url');
  const derivedKey = Buffer.from(match[6], 'base64url');

  if (
    parameters.version !== 19 ||
    !Number.isInteger(parameters.memory) ||
    parameters.memory < 7_168 ||
    parameters.memory > 262_144 ||
    !Number.isInteger(parameters.passes) ||
    parameters.passes < 1 ||
    parameters.passes > 10 ||
    !Number.isInteger(parameters.parallelism) ||
    parameters.parallelism < 1 ||
    parameters.parallelism > 4 ||
    salt.length < 16 ||
    salt.length > 64 ||
    derivedKey.length < 16 ||
    derivedKey.length > 64
  )
    return null;

  return { parameters: { ...parameters, tagLength: derivedKey.length }, salt, derivedKey };
}

function needsRehash(parameters) {
  return (
    parameters.version !== CURRENT_PARAMETERS.version ||
    parameters.memory !== CURRENT_PARAMETERS.memory ||
    parameters.passes !== CURRENT_PARAMETERS.passes ||
    parameters.parallelism !== CURRENT_PARAMETERS.parallelism ||
    parameters.tagLength !== CURRENT_PARAMETERS.tagLength
  );
}

async function hashPassword(
  password,
  { parameters = CURRENT_PARAMETERS, randomBytesFn = randomBytes, argon2Fn = argon2 } = {},
) {
  const validation = validatePassword(password);
  if (!validation.valid)
    throw Object.assign(new Error(validation.message), { code: 'invalid_password' });
  const salt = randomBytesFn(parameters.saltLength);
  const derivedKey = await deriveArgon2(password, salt, parameters, argon2Fn);
  return encodeVerifier(parameters, salt, derivedKey);
}

async function verifyPassword(password, verifier, { argon2Fn = argon2 } = {}) {
  const parsed = parseVerifier(verifier);
  if (!parsed || typeof password !== 'string' || passwordLength(password) > 128) {
    return { valid: false, needsRehash: false };
  }

  const actual = await deriveArgon2(password, parsed.salt, parsed.parameters, argon2Fn);
  return {
    valid: actual.length === parsed.derivedKey.length && timingSafeEqual(actual, parsed.derivedKey),
    needsRehash: needsRehash(parsed.parameters),
  };
}

module.exports = {
  CURRENT_PARAMETERS,
  DUMMY_PASSWORD_VERIFIER,
  hashPassword,
  normalizeUsername,
  parseVerifier,
  validatePassword,
  validateUsername,
  verifyPassword,
};
