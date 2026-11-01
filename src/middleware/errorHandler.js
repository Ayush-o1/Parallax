/**
 * src/middleware/errorHandler.js
 *
 * Central Express error-handling middleware.
 *
 * Why centralise error handling?
 *   Without this, every controller would need its own try/catch
 *   that formats and sends an error response. That leads to
 *   inconsistent response shapes and duplicated code. With a central
 *   handler, controllers call next(err) and the response format is
 *   always the same.
 *
 * Express identifies error-handling middleware by its four-argument
 * signature (err, req, res, next). This must be registered AFTER all
 * routes in app.js.
 *
 * Production rule:
 *   We never send internal stack traces to the client. Stacks are
 *   logged server-side for debugging; the client only receives a safe
 *   message. This prevents accidental information disclosure.
 */

'use strict';

const logger = require('../utils/logger');
const config = require('../config/env');

/**
 * Formats and sends a consistent JSON error response.
 *
 * @param {Error}  err
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next  - Required by Express signature.
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Operational errors may carry a preferred HTTP status.
  const status = err.status || err.statusCode || 500;

  // Log the full error internally, including the stack in development.
  logger.error('unhandled error', {
    status,
    message: err.message,
    // Use the route template rather than a raw URL that could contain IDs.
    path:    req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched',
    method:  req.method,
    // Only include stack in non-production to avoid log bloat in prod.
    ...(config.isDevelopment() && { stack: err.stack }),
  });

  const body = {
    success: false,
    error: {
      message: status < 500 ? err.message : 'Internal server error',
      // Expose the error code if present (e.g. 'VALIDATION_ERROR').
      ...(err.code && { code: err.code }),
    },
  };

  res.status(status).json(body);
}

module.exports = errorHandler;
