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

const config = require('./config/env');
const logger = require('./utils/logger');
const http = require('node:http');
const { Server: SocketServer } = require('socket.io');
const socketAuth = require('./realtime/socketAuth');
const realtimeHub = require('./realtime/hub');
const prisma = require('./db/prisma');

config.validateConfig();
const app = require('./app');

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: false }, serveClient: true });
io.use(socketAuth);
io.on('connection', (socket) => {
  // Every socket joins exactly one server-resolved tenant room.
  socket.join(`organization:${socket.data.organizationId}`);
});
realtimeHub.attach(io);

server.listen(config.port, () => {
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

let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);

  const forceExitTimer = setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
  forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    io.close(async () => {
      await prisma.$disconnect();
      logger.info('all connections closed, process exiting');
      process.exit(exitCode);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled promise rejections at the process level.
//
// Policy: log the rejection clearly, then EXIT.
//
// Why exit instead of continue?
//   Node.js emits 'unhandledRejection' when a rejected promise has no
//   .catch() handler. In Node 15+, the default behaviour is already to
//   exit with code 1. We make this explicit and controlled:
//
//   1. An unhandled rejection almost always means we are in an unknown
//      state (e.g. a database write failed silently, a lock was not
//      released). Continuing to serve traffic in an unknown state is
//      more dangerous than restarting cleanly.
//
//   2. Process managers (Docker restart policy, PM2, systemd) will
//      restart the process automatically, so an exit is a recoverable
//      event rather than a permanent outage.
//
//   3. The 'do not exit' strategy was appropriate when unhandled
//      rejections were less dangerous, but it masks bugs. We want
//      loud failures during development.
//
//   Exception: the 'close' event timeout timer created by shutdown()
//   is intentionally unguarded; if it fires it calls process.exit()
//   directly, so it never reaches this handler.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection — shutting down', {
    reason: reason instanceof Error ? reason.message : String(reason),
    ...(reason instanceof Error && config.isDevelopment() && { stack: reason.stack }),
  });
  shutdown('unhandled promise rejection', 1);
});

module.exports = server; // Exported for testing convenience.
