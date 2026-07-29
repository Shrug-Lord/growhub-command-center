'use strict';

const mqtt = require('mqtt');
const { parseFirmwareMessage, REQUIRED_STATE_KEYS, TOPICS } = require('./firmwareContract');

const RETAINED_STATE_GRACE_MS = 60_000;
const RETAINED_INCIDENT_MAX_AGE_MS = 30 * 86_400_000;

const SUBSCRIPTIONS = Object.freeze(
  Object.fromEntries(
    Object.keys(TOPICS).map((path) => [
      `growhub/+/${path}`,
      { qos: path === 'sensor/live' ? 0 : 1 },
    ]),
  ),
);

function createMqttService({
  url,
  clientId = 'growhub-command-center',
  stmts,
  logger,
  clock = () => Date.now(),
  connectFn = mqtt.connect,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  retainedStateGraceMs = RETAINED_STATE_GRACE_MS,
}) {
  let client = null;
  let brokerConnected = false;
  let subscriptionsReady = false;
  let generation = 0;
  let rebuildStartedAt = null;
  let lastConnectedAt = null;
  let lastDisconnectedAt = null;
  let lastError = null;
  const recoveryByDevice = new Map();
  const observers = new Set();

  function notifyObservers(method, event) {
    for (const observer of observers) {
      try {
        observer?.[method]?.(event);
      } catch (error) {
        logger.error('mqtt_observer_failed', {
          device_id: event.deviceId,
          observer_method: method,
          error,
        });
      }
    }
  }

  function urlForLog(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
    } catch (_) {
      return 'invalid-mqtt-url';
    }
  }

  function getSetting(key, fallback) {
    const row = stmts.getSetting.get(key);
    return row ? Number.parseFloat(row.value) : fallback;
  }

  function checkThresholdAlarms(deviceId, tempC, humidity) {
    const checks = [
      {
        type: 'temp_high',
        triggered: tempC > 0 && tempC > getSetting('alarm_temp_high', 32),
        severity: 'warning',
        message: `Temperature too high: ${tempC.toFixed(1)} C (limit ${getSetting('alarm_temp_high', 32)} C)`,
      },
      {
        type: 'temp_low',
        triggered: tempC > 0 && tempC < getSetting('alarm_temp_low', 15),
        severity: 'warning',
        message: `Temperature too low: ${tempC.toFixed(1)} C (limit ${getSetting('alarm_temp_low', 15)} C)`,
      },
      {
        type: 'humidity_high',
        triggered: humidity > 0 && humidity > getSetting('alarm_humidity_high', 85),
        severity: 'warning',
        message: `Humidity too high: ${humidity.toFixed(1)}% (limit ${getSetting('alarm_humidity_high', 85)}%)`,
      },
      {
        type: 'humidity_low',
        triggered: humidity > 0 && humidity < getSetting('alarm_humidity_low', 35),
        severity: 'warning',
        message: `Humidity too low: ${humidity.toFixed(1)}% (limit ${getSetting('alarm_humidity_low', 35)}%)`,
      },
    ];
    for (const check of checks) {
      if (check.triggered && !stmts.hasUnreadAlarmOfType.get(deviceId, check.type)) {
        stmts.insertAlarm.run({
          device_id: deviceId,
          type: check.type,
          message: check.message,
          severity: check.severity,
          created_at: clock(),
        });
        logger.warn('device_alarm_created', { device_id: deviceId, alarm_type: check.type });
      }
    }
  }

  function checkLightAlarm(deviceId, lightValue, actuator, tempC) {
    if (!actuator || tempC === 0) return;
    let outlets;
    let scheduleState;
    try {
      outlets =
        JSON.parse(
          stmts.getDeviceStateMirror.get(deviceId, 'outlet_state')?.normalized_json ?? '{}',
        ).outlets ?? [];
      scheduleState = JSON.parse(
        stmts.getDeviceStateMirror.get(deviceId, 'schedule_state')?.normalized_json ?? '{}',
      );
    } catch (_) {
      return;
    }
    const onOutletIds = new Set(
      (scheduleState.outlet_status ?? [])
        .filter((outlet) => outlet.state === 'on')
        .map((outlet) => outlet.id),
    );
    const lightOutlet = outlets.find(
      (outlet) => outlet.assignment === 'Light' && onOutletIds.has(outlet.id),
    );
    if (
      lightOutlet &&
      lightValue < 5 &&
      !stmts.hasUnreadAlarmOfType.get(deviceId, 'light_not_detected')
    ) {
      stmts.insertAlarm.run({
        device_id: deviceId,
        type: 'light_not_detected',
        message: `Outlet ${lightOutlet.id} (${lightOutlet.label}) is on but no light was detected.`,
        severity: 'warning',
        created_at: clock(),
      });
      logger.warn('device_alarm_created', {
        device_id: deviceId,
        alarm_type: 'light_not_detected',
      });
    }
  }

  function cancelRecoveryTimer(tracker) {
    if (!tracker?.timer) return;
    clearTimeoutFn(tracker.timer);
    tracker.timer = null;
  }

  function cancelRecoveryTimers() {
    for (const tracker of recoveryByDevice.values()) cancelRecoveryTimer(tracker);
  }

  function createTracker(deviceId) {
    const tracker = {
      deviceId,
      generation,
      received: new Set(),
      startedAt: subscriptionsReady ? clock() : null,
      timer: null,
    };
    recoveryByDevice.set(deviceId, tracker);
    return tracker;
  }

  function getTracker(deviceId) {
    const tracker = recoveryByDevice.get(deviceId);
    if (tracker?.generation === generation) return tracker;
    return createTracker(deviceId);
  }

  function pruneRetainedIncidents(deviceId, now) {
    stmts.deleteOldResolvedRetainedStateIncidents.run(now - RETAINED_INCIDENT_MAX_AGE_MS);
    stmts.trimResolvedRetainedStateIncidents.run({ device_id: deviceId });
  }

  function missingStates(tracker) {
    return REQUIRED_STATE_KEYS.filter((key) => !tracker.received.has(key));
  }

  function escalateMissingStates(tracker) {
    tracker.timer = null;
    if (!brokerConnected || !subscriptionsReady || tracker.generation !== generation) return;
    const now = clock();
    for (const stateKey of missingStates(tracker)) {
      stmts.insertRetainedStateIncident.run({
        device_id: tracker.deviceId,
        state_key: stateKey,
        started_at: tracker.startedAt,
        escalated_at: now,
      });
    }
    pruneRetainedIncidents(tracker.deviceId, now);
  }

  function scheduleRecoveryDeadline(tracker) {
    cancelRecoveryTimer(tracker);
    if (
      !brokerConnected ||
      !subscriptionsReady ||
      tracker.generation !== generation ||
      missingStates(tracker).length === 0
    )
      return;
    const delay = Math.max(0, tracker.startedAt + retainedStateGraceMs - clock());
    tracker.timer = setTimeoutFn(() => {
      try {
        escalateMissingStates(tracker);
      } catch (error) {
        logger.error('retained_state_escalation_failed', {
          device_id: tracker.deviceId,
          error,
        });
      }
    }, delay);
    tracker.timer?.unref?.();
  }

  function beginRecoveryGeneration() {
    generation += 1;
    brokerConnected = true;
    subscriptionsReady = false;
    rebuildStartedAt = null;
    lastConnectedAt = clock();
    lastError = null;
    cancelRecoveryTimers();
    recoveryByDevice.clear();
    for (const row of stmts.getKnownDeviceIds.all()) createTracker(row.id);
  }

  function markSubscriptionsReady() {
    if (!brokerConnected) return;
    subscriptionsReady = true;
    rebuildStartedAt = clock();
    for (const tracker of recoveryByDevice.values()) {
      tracker.startedAt = rebuildStartedAt;
      scheduleRecoveryDeadline(tracker);
    }
  }

  function markBrokerDisconnected() {
    if (!brokerConnected && !subscriptionsReady) return;
    brokerConnected = false;
    subscriptionsReady = false;
    rebuildStartedAt = null;
    lastDisconnectedAt = clock();
    cancelRecoveryTimers();
  }

  function markStateReceived(deviceId, stateKey, receivedAt) {
    if (!REQUIRED_STATE_KEYS.includes(stateKey)) return;
    const tracker = getTracker(deviceId);
    if (tracker.startedAt === null && subscriptionsReady) tracker.startedAt = receivedAt;
    tracker.received.add(stateKey);
    stmts.resolveRetainedStateIncident.run({
      device_id: deviceId,
      state_key: stateKey,
      resolved_at: receivedAt,
    });
    pruneRetainedIncidents(deviceId, receivedAt);
    scheduleRecoveryDeadline(tracker);
  }

  function handlePresenceTransition(deviceId, previousState, currentState, now) {
    const previous = previousState?.status ?? null;
    const current = currentState.status;
    if (previous === current) return;
    if (current === 'online') {
      const wasOffline = Boolean(stmts.hasUnreadAlarmOfType.get(deviceId, 'device_offline'));
      stmts.resolveAlarmType.run(deviceId, 'device_offline');
      if (previous === 'offline' || wasOffline) {
        stmts.insertEvent.run({
          device_id: deviceId,
          schedule_id: null,
          type: 'device_online',
          phase: null,
          label: 'Device came online',
          notes: null,
          occurred_at: now,
          created_at: now,
        });
      }
      return;
    }
    if (!stmts.hasUnreadAlarmOfType.get(deviceId, 'device_offline')) {
      stmts.insertAlarm.run({
        device_id: deviceId,
        type: 'device_offline',
        message: 'Firmware reported the device offline.',
        severity: 'critical',
        created_at: now,
      });
    }
    if (previous === 'online') {
      stmts.insertEvent.run({
        device_id: deviceId,
        schedule_id: null,
        type: 'device_offline',
        phase: null,
        label: 'Device went offline',
        notes: null,
        occurred_at: now,
        created_at: now,
      });
    }
  }

  function persistState(message, packet, receivedAt) {
    const existingDevice = stmts.getDevice.get(message.mac);
    if (!existingDevice && !message.discoveryCapable) {
      logger.debug?.('mqtt_unknown_device_message_ignored', { message_type: message.key });
      return false;
    }

    let previousPresence = null;
    if (message.key === 'presence_state') {
      const previous = stmts.getDeviceStateMirror.get(message.mac, message.key);
      if (previous?.normalized_json) {
        try {
          previousPresence = JSON.parse(previous.normalized_json);
        } catch (_) {}
      }
    }

    if (!existingDevice) {
      stmts.ensureDevice.run({ id: message.mac, observed_at: receivedAt });
    }
    const persisted = stmts.upsertDeviceStateMirror.get({
      device_id: message.mac,
      state_key: message.key,
      schema_version: message.schemaVersion,
      normalized_json: message.normalized === null ? null : JSON.stringify(message.normalized),
      raw_json: message.raw,
      received_at: receivedAt,
      mqtt_retained: packet?.retain === true ? 1 : 0,
      compatible: message.compatible ? 1 : 0,
      compatibility_reason: message.compatibilityReason,
    });

    if (message.key === 'presence_state') {
      stmts.setMirroredDevicePresence.run({
        device_id: message.mac,
        presence_status: message.normalized.status,
        presence_received_at: receivedAt,
        updated_at: receivedAt,
      });
      handlePresenceTransition(message.mac, previousPresence, message.normalized, receivedAt);
    } else if (message.key === 'outlet_state' && message.compatible) {
      stmts.setMirroredDeviceOutlets.run({
        device_id: message.mac,
        outlet_state_json: JSON.stringify(message.normalized.outlets),
        updated_at: receivedAt,
      });
    } else if (message.key === 'schedule_state') {
      if (message.compatible) {
        stmts.setMirroredDeviceMode.run({
          device_id: message.mac,
          current_mode: message.normalized.mode,
          updated_at: receivedAt,
        });
      } else {
        stmts.setMirroredDeviceMode.run({
          device_id: message.mac,
          current_mode: null,
          updated_at: receivedAt,
        });
      }
    } else if (message.key === 'sensor_state') {
      const sensor = message.normalized;
      stmts.upsertDevice.run({
        id: message.mac,
        name: sensor.reported_name,
        ip: null,
        fw: sensor.firmware_version,
        last_seen: receivedAt,
      });
      stmts.insertMeasurement.run({
        device_id: message.mac,
        taken_at: sensor.observed_at,
        temp: sensor.temperature_c,
        humidity: sensor.humidity_rh,
        light: sensor.light_level,
        co2: sensor.co2_ppm,
        actuator: sensor.actuator_summary,
        fw: sensor.firmware_version,
      });
      checkThresholdAlarms(message.mac, sensor.temperature_c, sensor.humidity_rh);
      checkLightAlarm(
        message.mac,
        sensor.light_level,
        sensor.actuator_summary,
        sensor.temperature_c,
      );
    }

    markStateReceived(message.mac, message.key, receivedAt);
    logger.debug?.('mqtt_state_observed', {
      device_id: message.mac,
      state_key: message.key,
      state_revision: persisted.revision,
    });
    if (message.compatible) {
      notifyObservers('observeState', {
        deviceId: message.mac,
        stateKey: message.key,
        revision: persisted.revision,
        value: message.normalized,
        receivedAt,
      });
    }
    return true;
  }

  function persistError(message, receivedAt) {
    if (!stmts.getDevice.get(message.mac)) {
      logger.debug?.('mqtt_unknown_device_message_ignored', { message_type: message.key });
      return false;
    }
    const persisted = stmts.upsertDeviceErrorMirror.get({
      device_id: message.mac,
      error_key: message.key,
      normalized_json: JSON.stringify(message.normalized),
      raw_json: message.raw,
      received_at: receivedAt,
    });
    logger.info('mqtt_firmware_error_observed', {
      device_id: message.mac,
      error_key: message.key,
      error_sequence: persisted.sequence,
      reason: message.normalized.reason,
    });
    notifyObservers('observeError', {
      deviceId: message.mac,
      errorKey: message.key,
      sequence: persisted.sequence,
      value: message.normalized,
      receivedAt,
    });
    return true;
  }

  function processMessage(topic, payload, packet = {}) {
    const message = parseFirmwareMessage(topic, payload);
    if (!message.ok) {
      logger.warn('mqtt_message_rejected', { reason: message.reason });
      return false;
    }
    const receivedAt = clock();
    try {
      return message.kind === 'state'
        ? persistState(message, packet, receivedAt)
        : persistError(message, receivedAt);
    } catch (error) {
      logger.error('mqtt_message_persist_failed', {
        device_id: message.mac,
        message_type: message.key,
        error,
      });
      return false;
    }
  }

  function connect() {
    if (client) return client;
    client = connectFn(url, {
      clientId,
      clean: true,
      reconnectPeriod: 5_000,
      resubscribe: false,
    });

    client.on('connect', () => {
      beginRecoveryGeneration();
      logger.info('mqtt_connected', { mqtt_url: urlForLog(url) });
      client.subscribe(SUBSCRIPTIONS, (error, granted = []) => {
        const rejected = granted.some((entry) => entry.qos === 128);
        if (error || rejected || granted.length !== Object.keys(SUBSCRIPTIONS).length) {
          lastError = 'subscription_failed';
          logger.error('mqtt_subscribe_failed', {
            topic_count: Object.keys(SUBSCRIPTIONS).length,
            error: error || new Error('MQTT subscription was not fully granted'),
          });
          return;
        }
        markSubscriptionsReady();
        logger.info('mqtt_subscribed', { topic_count: granted.length });
      });
    });
    client.on('message', processMessage);
    client.on('error', (error) => {
      lastError = 'connection_error';
      logger.error('mqtt_error', { error });
    });
    client.on('reconnect', () => logger.info('mqtt_reconnecting'));
    client.on('offline', () => {
      markBrokerDisconnected();
      logger.warn('mqtt_offline');
    });
    client.on('close', markBrokerDisconnected);
    return client;
  }

  function publish(topic, payload) {
    if (!client || !client.connected) throw new Error('MQTT client not connected');
    client.publish(topic, String(payload), { qos: 1, retain: false });
  }

  function publishAction(topic, payload, callback) {
    if (!client || !client.connected) throw new Error('MQTT client not connected');
    client.publish(topic, String(payload), { qos: 1, retain: false }, callback);
  }

  function addObserver(observer) {
    observers.add(observer);
    return () => observers.delete(observer);
  }

  function disconnect() {
    cancelRecoveryTimers();
    markBrokerDisconnected();
    if (!client) return Promise.resolve();
    const closingClient = client;
    client = null;
    return new Promise((resolve) => closingClient.end(false, {}, resolve));
  }

  function isConnected() {
    return Boolean(client?.connected && brokerConnected);
  }

  function getDeviceSyncState(deviceId) {
    const tracker = recoveryByDevice.get(deviceId);
    const missing =
      tracker?.generation === generation ? missingStates(tracker) : [...REQUIRED_STATE_KEYS];
    const graceExpired =
      tracker?.startedAt !== null &&
      tracker?.startedAt !== undefined &&
      clock() >= tracker.startedAt + retainedStateGraceMs;
    const activeIncidents = graceExpired
      ? stmts.getActiveRetainedStateIncidents.all(deviceId).map((incident) => incident.state_key)
      : [];
    return {
      status: !brokerConnected
        ? 'broker_unavailable'
        : !subscriptionsReady || missing.length > 0
          ? 'syncing'
          : 'ready',
      generation,
      missingStates: missing,
      escalatedStates: activeIncidents.filter((key) => missing.includes(key)),
      startedAt: tracker?.startedAt ?? rebuildStartedAt,
      graceExpiresAt:
        tracker?.startedAt === null || tracker?.startedAt === undefined
          ? null
          : tracker.startedAt + retainedStateGraceMs,
    };
  }

  function getHealth() {
    let syncingDeviceCount = 0;
    let missingStateCount = 0;
    if (brokerConnected) {
      for (const tracker of recoveryByDevice.values()) {
        const count = missingStates(tracker).length;
        if (count > 0) syncingDeviceCount += 1;
        missingStateCount += count;
      }
    }
    return {
      broker: {
        status: brokerConnected ? 'connected' : 'disconnected',
        subscriptionsReady,
        lastConnectedAt,
        lastDisconnectedAt,
        lastError,
      },
      retainedStateRebuild: {
        generation,
        startedAt: rebuildStartedAt,
        deviceCount: recoveryByDevice.size,
        syncingDeviceCount,
        missingStateCount,
      },
    };
  }

  return {
    connect,
    disconnect,
    getDeviceSyncState,
    getHealth,
    isConnected,
    processMessage,
    addObserver,
    publish,
    publishAction,
  };
}

module.exports = {
  RETAINED_STATE_GRACE_MS,
  SUBSCRIPTIONS,
  createMqttService,
};
