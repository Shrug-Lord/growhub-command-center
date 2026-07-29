'use strict';

const path = require('node:path');
const { parseTrustedProxyList } = require('./clientIp');

const LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug']);
const NODE_ENVS = new Set(['development', 'test', 'production']);
const MQTT_PROTOCOLS = new Set(['mqtt:', 'mqtts:', 'ws:', 'wss:']);

class ConfigurationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ConfigurationError';
    this.code = 'invalid_configuration';
    this.field = field;
  }
}

function optionalText(env, field, fallback) {
  const raw = env[field];
  if (raw === undefined) return fallback;
  const value = String(raw).trim();
  if (!value) throw new ConfigurationError(`${field} must not be empty`, field);
  return value;
}

function integer(env, field, fallback, { min, max }) {
  const raw = env[field];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw))) {
    throw new ConfigurationError(`${field} must be an integer`, field);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigurationError(`${field} must be between ${min} and ${max}`, field);
  }
  return value;
}

function mqttUrl(env) {
  const raw = optionalText(env, 'MQTT_URL', 'mqtt://127.0.0.1:1883');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    throw new ConfigurationError('MQTT_URL must be a valid MQTT URL', 'MQTT_URL');
  }
  if (!MQTT_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
    throw new ConfigurationError(
      'MQTT_URL must use mqtt, mqtts, ws, or wss and include a host',
      'MQTT_URL',
    );
  }
  return raw;
}

function mqttClientId(env) {
  const value = optionalText(env, 'MQTT_CLIENT_ID', 'growhub-command-center');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    throw new ConfigurationError(
      'MQTT_CLIENT_ID must contain 1-128 letters, numbers, dots, underscores, or hyphens',
      'MQTT_CLIENT_ID',
    );
  }
  return value;
}

function configuredPath(env, field, fallback) {
  if (env[field] === undefined) return path.resolve(fallback);
  const value = String(env[field]).trim();
  if (!value) throw new ConfigurationError(`${field} must not be empty`, field);
  return path.resolve(value);
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function loadConfig(env = process.env) {
  const nodeEnv = optionalText(env, 'NODE_ENV', 'development').toLowerCase();
  if (!NODE_ENVS.has(nodeEnv)) {
    throw new ConfigurationError('NODE_ENV must be development, test, or production', 'NODE_ENV');
  }

  const logLevel = optionalText(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    throw new ConfigurationError('LOG_LEVEL must be error, warn, info, or debug', 'LOG_LEVEL');
  }

  const defaultDataDir = path.join(__dirname, '../data');
  const appDataDir = configuredPath(env, 'APP_DATA_DIR', defaultDataDir);
  const rawDbPath = env.DB_PATH === undefined ? '' : String(env.DB_PATH).trim();
  if (env.DB_PATH !== undefined && !rawDbPath) {
    throw new ConfigurationError('DB_PATH must not be empty', 'DB_PATH');
  }
  const dbPath =
    rawDbPath === ':memory:'
      ? rawDbPath
      : path.resolve(rawDbPath || path.join(appDataDir, 'growhub.db'));
  if (dbPath !== ':memory:' && !isPathInside(appDataDir, dbPath)) {
    throw new ConfigurationError('DB_PATH must be inside APP_DATA_DIR', 'DB_PATH');
  }

  const distDir = configuredPath(env, 'DIST_DIR', path.join(__dirname, '../../../dist'));

  let trustedProxies;
  try {
    trustedProxies = parseTrustedProxyList(env.TRUSTED_PROXIES);
  } catch (error) {
    throw new ConfigurationError(
      `TRUSTED_PROXIES must be a comma-separated list of IP addresses or CIDR ranges: ${error.message}`,
      'TRUSTED_PROXIES',
    );
  }

  return Object.freeze({
    nodeEnv,
    host: optionalText(env, 'HOST', '0.0.0.0'),
    port: integer(env, 'PORT', 3000, { min: 1, max: 65_535 }),
    logLevel,
    mqttUrl: mqttUrl(env),
    mqttClientId: mqttClientId(env),
    appDataDir,
    dbPath,
    distDir,
    trustedProxies,
    shutdownDrainMs: 10_000,
    shutdownDeadlineMs: 30_000,
    retentionSweepMs: 3_600_000,
  });
}

module.exports = { ConfigurationError, loadConfig };
