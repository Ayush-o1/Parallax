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
 * Why listen to both 'finish' and 'close'?
 *   The 'finish' event fires when the response has been fully flushed
 *   to the socket — the normal success case. The 'close' event fires
 *   when the underlying socket closes, which also covers aborted
 *   requests where the client disconnects before the response is sent.
 *   Without both, a request that is aborted mid-flight never produces
 *   a log line, making it invisible during debugging.
 *
 *   We use a 'done' flag to ensure only one log line is produced per
 *   request regardless of which event fires first.
 */

'use strict';

const { randomUUID } = require('node:crypto');
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
  // Generate server-side so clients cannot spoof correlation IDs.
  const reqId = randomUUID();
  req.reqId = reqId;
  res.setHeader('X-Request-Id', reqId);

  let done = false;

  function logRequest(event) {
    if (done) return;
    done = true;

    const duration = Date.now() - startedAt;

    logger.info('http request', {
      reqId,
      method:     req.method,
      // Route templates avoid writing VINs, tokens, or other identifiers
      // that callers might include in concrete URL path segments.
      path:       req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
      status:     res.statusCode,
      durationMs: duration,
      event,       // 'finish' (normal) or 'close' (aborted)
      completed: res.writableEnded,
    });
  }

  res.on('finish', () => logRequest('finish'));
  res.on('close',  () => logRequest('close'));

  next();
}

module.exports = requestLogger;
