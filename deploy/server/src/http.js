'use strict';

const { randomUUID } = require('node:crypto');

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorBody(req, error) {
  const body = {
    error: {
      code: error.code,
      message: error.message,
    },
    request_id: req.requestId,
  };
  if (error.details !== undefined) body.error.details = error.details;
  return body;
}

function sendError(req, res, status, code, message, details) {
  return res.status(status).json(errorBody(req, new HttpError(status, code, message, details)));
}

function requestContext({ logger, uuid = randomUUID, clock = () => Date.now() }) {
  return (req, res, next) => {
    const startedAt = clock();
    req.requestId = uuid();
    res.setHeader('X-Request-ID', req.requestId);
    res.on('finish', () => {
      const fields = {
        request_id: req.requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Math.max(0, clock() - startedAt),
      };
      if (res.statusCode >= 500) logger.error('http_request_completed', fields);
      else if (res.statusCode >= 400) logger.info('http_request_completed', fields);
      else logger.debug('http_request_completed', fields);
    });
    next();
  };
}

function errorHandler(logger) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof HttpError) {
      if (Number.isInteger(err.retryAfterSeconds) && err.retryAfterSeconds > 0) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds));
      }
      res.status(err.status).json(errorBody(req, err));
      return;
    }

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      res
        .status(400)
        .json(
          errorBody(
            req,
            new HttpError(400, 'invalid_json', 'Request body must contain valid JSON.'),
          ),
        );
      return;
    }

    logger.error('http_request_failed', {
      request_id: req.requestId,
      method: req.method,
      path: req.path,
      error: err,
    });
    res
      .status(500)
      .json(
        errorBody(
          req,
          new HttpError(500, 'internal_error', 'An unexpected server error occurred.'),
        ),
      );
  };
}

module.exports = { HttpError, errorHandler, requestContext, sendError };
