import { checkReadiness, requestJson } from './apiClient.js'

function toDevice(device) {
  const sensor = device.sensor
    ? {
        t: device.sensor.temperature_c,
        h: device.sensor.humidity_rh,
        l: device.sensor.light_level,
        c2: device.sensor.co2_ppm,
        a: device.sensor.actuator_summary,
        ts: device.sensor.observed_at,
      }
    : null
  return {
    _id: device.id,
    name: device.name,
    displayName: device.display_name,
    reportedName: device.reported_name,
    firmwareVersion: device.firmware_version,
    hidden: device.hidden,
    presence: device.presence,
    mirror: device.mirror,
    compatibility: device.compatibility,
    outlets: (device.outlets ?? []).map((outlet) => ({
      ...outlet,
      type: outlet.assignment,
    })),
    outletState: device.outlet_state,
    scheduleState: device.schedule,
    scheduleMirror: device.schedule_state,
    sensor,
    sensorState: device.sensor_state,
    stateRevisions: device.state_revisions ?? {},
    pendingActions: device.pending_actions ?? [],
    warnings: device.warnings ?? [],
    setup: device.setup ?? null,
    expectedSchedule: device.expected_schedule ?? null,
    drift: device.drift ?? null,
    driftActions: device.drift_actions ?? null,
    labelDrift: device.label_drift ?? [],
    actionAvailability: device.action_availability ?? {},
  }
}

function toTemplate(template) {
  return { ...template, _id: template.id }
}

function toAlert(alert) {
  return {
    _id: alert.id,
    deviceId: alert.device_id,
    type: alert.type,
    message: alert.message,
    severity: alert.severity,
    read: alert.acknowledged,
    createdAt: alert.created_at,
  }
}

function toEvent(event) {
  return {
    _id: event.id,
    deviceId: event.device_id,
    scheduleId: event.schedule_id,
    type: event.type,
    phase: event.phase,
    label: event.label,
    notes: event.notes,
    occurredAt: event.occurred_at,
    createdAt: event.created_at,
  }
}

function toSession(session) {
  return {
    csrfToken: session.csrf_token,
    expiresAt: session.expires_at,
    user: {
      ...session.user,
      devices: (session.user?.devices ?? []).map(toDevice),
    },
  }
}

export async function setupAdmin({ username, password, passwordConfirmation }) {
  const body = await requestJson('/api/v1/setup', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      password_confirmation: passwordConfirmation,
    }),
  })
  return body.setup
}

export async function login({ username, password }) {
  const body = await requestJson('/api/v1/session', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return toSession(body.session)
}

export async function validateSession() {
  const body = await requestJson('/api/v1/session')
  return toSession(body.session)
}

export async function getAuthBootstrap() {
  const body = await requestJson('/api/v1/bootstrap')
  return {
    session: body.bootstrap.session ? toSession(body.bootstrap.session) : null,
    setupRequired: body.bootstrap.setup_required,
  }
}

export async function logoutSession() {
  const body = await requestJson('/api/v1/session', { method: 'DELETE' })
  return body.session
}

export async function changeAdminUsername({ username, currentPassword }) {
  return requestJson('/api/v1/admin/username', {
    method: 'PATCH',
    body: JSON.stringify({ username, current_password: currentPassword }),
  })
}

export async function changeAdminPassword({ currentPassword, password, passwordConfirmation }) {
  return requestJson('/api/v1/admin/password', {
    method: 'PATCH',
    body: JSON.stringify({
      current_password: currentPassword,
      password,
      password_confirmation: passwordConfirmation,
    }),
  })
}

export { checkReadiness }

export async function getDeviceLogsRange({ deviceId, fromDate, toDate }) {
  const params = new URLSearchParams({ deviceId })
  if (fromDate) params.set('fromDate', fromDate)
  if (toDate) params.set('toDate', toDate)
  const body = await requestJson(`/api/v1/data-logs/rangev3?${params}`, {})
  return body.series
}

export async function createDeviceAction({ deviceId, type, input = {} }) {
  const body = await requestJson(`/api/v1/devices/${deviceId}/actions`, {
    method: 'POST',
    body: JSON.stringify({ type, input }),
  })
  return body.action
}

export async function getDeviceAction({ deviceId, actionId }) {
  const body = await requestJson(`/api/v1/devices/${deviceId}/actions/${actionId}`)
  return body.action
}

export async function waitForDeviceAction({
  deviceId,
  action,
  pollIntervalMs = 500,
  fallbackTimeoutMs = 20_000,
}) {
  let current = action
  const actionDeadline = Date.parse(action?.timeout_at)
  const deadline =
    (Number.isFinite(actionDeadline) ? actionDeadline : Date.now() + fallbackTimeoutMs) + 1_000

  while (current?.status === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    current = await getDeviceAction({ deviceId, actionId: current.id })
  }

  return current
}

export async function getDeviceActivity({ deviceId, limit = 25, cursor } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return requestJson(`/api/v1/devices/${deviceId}/activity?${params}`)
}

export async function getDevices() {
  const body = await requestJson('/api/v1/devices')
  return body.devices.map(toDevice)
}

export async function getDevice({ deviceId }) {
  const body = await requestJson(`/api/v1/devices/${deviceId}`)
  return toDevice(body.device)
}

export async function getServerHealth() {
  const body = await requestJson('/api/v1/server/health')
  return body.server_health
}

export async function getDiagnosticsSummary() {
  const body = await requestJson('/api/v1/diagnostics')
  return body.diagnostics
}

export async function getDeviceDiagnostics({ deviceId } = {}) {
  const body = await requestJson(`/api/v1/diagnostics/devices/${encodeURIComponent(deviceId)}`)
  return body.diagnostics
}

export async function getDiagnosticsExport() {
  const body = await requestJson('/api/v1/diagnostics/export')
  return body.diagnostics
}

export async function getScheduleTemplates() {
  const body = await requestJson('/api/v1/schedule-templates')
  return body.templates.map(toTemplate)
}

export async function getScheduleTemplate({ id } = {}) {
  const body = await requestJson(`/api/v1/schedule-templates/${id}`)
  return toTemplate(body.template)
}

export async function createScheduleTemplate({ template } = {}) {
  const body = await requestJson('/api/v1/schedule-templates', {
    method: 'POST',
    body: JSON.stringify(template),
  })
  return toTemplate(body.template)
}

export async function updateScheduleTemplate({ id, template } = {}) {
  const body = await requestJson(`/api/v1/schedule-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(template),
  })
  return toTemplate(body.template)
}

export async function deleteScheduleTemplate({ id } = {}) {
  const body = await requestJson(`/api/v1/schedule-templates/${id}`, {
    method: 'DELETE',
  })
  return body.template
}

export async function getScheduleTemplateRevisions({ id } = {}) {
  const body = await requestJson(`/api/v1/schedule-templates/${id}/revisions`)
  return body.revisions
}

export async function preflightSchedule({ deviceId, templateId, mappings } = {}) {
  const body = await requestJson(`/api/v1/devices/${deviceId}/schedule-preflight`, {
    method: 'POST',
    body: JSON.stringify({ template_id: templateId, mappings }),
  })
  return body.preflight
}

export async function getScheduleDrift({ deviceId } = {}) {
  const body = await requestJson(`/api/v1/devices/${deviceId}/schedule-drift`)
  return body.drift
}

export async function getAlarms({ userId } = {}) {
  const body = await requestJson(`/api/v1/alarms/user/${userId || 'local-user-1'}`, {})
  return body.alerts.map(toAlert)
}

export async function markAlarmsRead({ userId } = {}) {
  const body = await requestJson(`/api/v1/alarms/user/${userId || 'local-user-1'}`, {
    method: 'PUT',
  })
  return body.alerts
}

export async function getSettings() {
  const body = await requestJson('/api/v1/settings')
  return body.settings
}

export async function updateSettings({ settings } = {}) {
  const body = await requestJson('/api/v1/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
  return body.settings
}

export async function getDeviceOutlets({ deviceId }) {
  const body = await requestJson(`/api/v1/devices/${deviceId}/outlets`, {})
  return body.outlets.map((outlet) => ({ ...outlet, type: outlet.assignment }))
}

export async function updateDeviceOutlets({
  deviceId,
  outlets,
  baseFingerprint,
  labelOnly = false,
}) {
  return createDeviceAction({
    deviceId,
    type: labelOnly ? 'repair_outlet_label' : 'update_outlet_config',
    input: {
      outlets: outlets.map((outlet) => ({
        id: outlet.id,
        assignment: outlet.assignment ?? outlet.type,
        label: outlet.label,
      })),
      base_fingerprint: baseFingerprint,
    },
  })
}

export async function renameDevice({ deviceId, name }) {
  const body = await requestJson(`/api/v1/iot-devices/${deviceId}/name`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  })
  return body.device
}

export async function getEvents({ deviceId } = {}) {
  const body = await requestJson(`/api/v1/events?deviceId=${encodeURIComponent(deviceId)}`, {})
  return body.events.map(toEvent)
}

export async function createEvent({ event } = {}) {
  const body = await requestJson('/api/v1/events', {
    method: 'POST',
    body: JSON.stringify(event),
  })
  return toEvent(body.event)
}

export async function deleteEvent({ id } = {}) {
  const body = await requestJson(`/api/v1/events/${id}`, {
    method: 'DELETE',
  })
  return body.event
}

export async function getCurrentPhase({ deviceId } = {}) {
  const body = await requestJson(
    `/api/v1/events/phase/current?deviceId=${encodeURIComponent(deviceId)}`,
    {},
  )
  return { phase: body.current_phase.phase }
}
