/**
 * src/middleware/requestLogger.js
 *
 * Logs every incoming HTTP request and its outcome.
 *
 * Why log at the middleware layer?
 *   Every request passes through middleware before it reaches a
 *   controller, so this is the single place where we can guarantee
 *   coverage without cluttering business logic. Logging here also
 *   captures requests that fail before they reach a controller
 *   (e.g. JSON parse errors, payload size limits).
 *
 * We log on the 'finish' event rather than on entry so we can
 * include the response status code and duration in the same line.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * Express middleware that emits a structured log line per request.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startedAt;

    logger.info('http request', {
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      durationMs: duration,
      // Only log the IP in development; in production you'd use a
      // request-ID header injected by a load balancer instead.
      ip: req.ip,
    });
  });

  next();
}

module.exports = requestLogger;
