/**
 * src/server.js
 *
 * HTTP server entry point.
 *
 * Responsibilities:
 *   - Import the configured Express app.
 *   - Bind to the port defined in environment configuration.
 *   - Handle startup errors (e.g. port already in use).
 *   - Handle graceful shutdown on SIGTERM / SIGINT so in-flight
 *     requests complete before the process exits.
 *
 * Why graceful shutdown?
 *   If the process exits immediately on SIGTERM (e.g. during a
 *   deployment), active requests are cut off mid-response. Calling
 *   server.close() stops accepting new connections while letting
 *   existing ones finish. This is standard practice and expected in
 *   any production-ready service.
 */

'use strict';

const app    = require('./app');
const config = require('./config/env');
const logger = require('./utils/logger');

const server = app.listen(config.port, () => {
  logger.info('parallax server started', {
    port:    config.port,
    nodeEnv: config.nodeEnv,
  });
});

// ── Error handling ─────────────────────────────────────────────────────────

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`port ${config.port} is already in use`, { code: err.code });
  } else {
    logger.error('server error', { message: err.message, code: err.code });
  }
  process.exit(1);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────

function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);

  server.close(() => {
    logger.info('all connections closed, process exiting');
    process.exit(0);
  });

  // Force exit if connections do not close within 10 seconds.
  // This prevents the process from hanging indefinitely if a client
  // keeps a connection open (e.g. long-polling or a keep-alive socket).
  setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled promise rejections at the process level.
// This should not happen if every async function is wrapped in try/catch,
// but it provides a safety net and prevents silent failures in Node 24.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
  // Do not exit — one unhandled rejection should not kill the server.
  // In Phase 10 (workers), worker processes should exit on unhandled
  // rejections because a crashed worker needs to be restarted cleanly.
});

module.exports = server; // Exported for testing convenience.
