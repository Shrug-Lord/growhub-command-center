const BASE_URL = ''
const DEFAULT_TIMEOUT_MS = 10_000
const READINESS_TIMEOUT_MS = 3_000

const availabilityListeners = new Set()
let csrfToken = null

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export class ApiError extends Error {
  constructor({ status = 0, code, message, details, requestId, kind = 'http', cause }) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
    this.kind = kind
    if (cause !== undefined) this.cause = cause
  }
}

export function subscribeApiIssues(listener) {
  availabilityListeners.add(listener)
  return () => availabilityListeners.delete(listener)
}

export function setCsrfToken(value) {
  csrfToken = typeof value === 'string' && value ? value : null
}

export function clearCsrfToken() {
  csrfToken = null
}

function publishApiIssue(error) {
  for (const listener of availabilityListeners) listener(error)
}

function availabilityError(
  { status = 0, code, message, kind, requestId, cause },
  { reportAvailability = true } = {},
) {
  const error = new ApiError({ status, code, message, kind, requestId, cause })
  if (reportAvailability) publishApiIssue(error)
  return error
}

function makeAbortController(externalSignal, timeoutMs) {
  const controller = new AbortController()
  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const onExternalAbort = () => controller.abort(externalSignal.reason)
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort()
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  }

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timeout)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    },
  }
}

async function readJson(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function requestJson(path, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    reportAvailability = true,
    signal: externalSignal,
    headers: suppliedHeaders,
    ...fetchOptions
  } = options
  const abort = makeAbortController(externalSignal, timeoutMs)
  const headers = { Accept: 'application/json', ...suppliedHeaders }
  const method = String(fetchOptions.method || 'GET').toUpperCase()
  if (fetchOptions.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (!SAFE_METHODS.has(method) && csrfToken && !headers['X-CSRF-Token']) {
    headers['X-CSRF-Token'] = csrfToken
  }

  let response
  let body
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...fetchOptions,
      credentials: 'same-origin',
      headers,
      signal: abort.signal,
    })
    body = await readJson(response)
  } catch (cause) {
    if (externalSignal?.aborted && !abort.didTimeOut()) {
      throw new ApiError({
        code: 'request_cancelled',
        message: 'Request cancelled.',
        kind: 'cancelled',
        cause,
      })
    }
    if (abort.didTimeOut()) {
      throw availabilityError(
        {
          code: 'request_timed_out',
          message: 'Command Center did not respond in time.',
          kind: 'timeout',
          cause,
        },
        { reportAvailability },
      )
    }
    throw availabilityError(
      {
        code: 'server_unavailable',
        message: 'Command Center is unavailable.',
        kind: 'network',
        cause,
      },
      { reportAvailability },
    )
  } finally {
    abort.cleanup()
  }

  const requestId = response.headers.get('x-request-id') || undefined

  if (!response.ok) {
    if (body?.error?.code) {
      const error = new ApiError({
        status: response.status,
        code: body.error.code,
        message: body.error.message || 'The request failed.',
        details: body.error.details,
        requestId: body.request_id || requestId,
        kind: body.error.code === 'server_shutting_down' ? 'shutdown' : 'http',
      })
      if (error.kind === 'shutdown' && reportAvailability) publishApiIssue(error)
      throw error
    }

    if ([502, 503, 504].includes(response.status)) {
      throw availabilityError(
        {
          status: response.status,
          code: 'server_unavailable',
          message: 'Command Center is unavailable.',
          kind: 'proxy',
          requestId,
        },
        { reportAvailability },
      )
    }

    throw new ApiError({
      status: response.status,
      code: 'http_error',
      message: 'The request failed.',
      requestId,
    })
  }

  if (body === null) {
    throw availabilityError(
      {
        status: response.status,
        code: 'invalid_response',
        message: 'Command Center returned an invalid response.',
        kind: 'protocol',
        requestId,
      },
      { reportAvailability },
    )
  }

  return body
}

export async function checkReadiness({ timeoutMs = READINESS_TIMEOUT_MS } = {}) {
  const abort = makeAbortController(undefined, timeoutMs)
  let response
  let body
  try {
    response = await fetch(`${BASE_URL}/health/ready`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal: abort.signal,
    })
    body = await readJson(response)
  } catch (cause) {
    throw availabilityError({
      code: abort.didTimeOut() ? 'request_timed_out' : 'server_unavailable',
      message: abort.didTimeOut()
        ? 'Command Center did not respond in time.'
        : 'Command Center is unavailable.',
      kind: abort.didTimeOut() ? 'timeout' : 'network',
      cause,
    })
  } finally {
    abort.cleanup()
  }

  if (response.ok && body?.status === 'ready') return { ready: true, reason: null }
  if (response.status === 503 && body?.status === 'not_ready') {
    return { ready: false, reason: body.reason || 'starting' }
  }

  throw availabilityError({
    status: response.status,
    code: 'server_unavailable',
    message: 'Command Center readiness could not be confirmed.',
    kind: 'proxy',
    requestId: response.headers.get('x-request-id') || undefined,
  })
}
