/**
 * src/app.js
 *
 * Express application factory.
 *
 * Why separate app.js from server.js?
 *   server.js is responsible for binding to a network port (I/O side effect).
 *   app.js is responsible for configuring Express (pure setup).
 *
 *   This separation matters for testing: test files import app.js and
 *   hand it to supertest, which starts the server on a random port
 *   without ever calling server.js. This avoids port conflicts and
 *   makes tests fully self-contained.
 *
 * Middleware registration order matters:
 *   1. Body parsing — must come before any route that reads req.body.
 *   2. Request logging — as early as possible so every request is captured.
 *   3. Routes — the actual application endpoints.
 *   4. 404 handler — catches any request that did not match a route.
 *   5. Error handler — must be LAST; Express identifies it by its 4-arg signature.
 */

'use strict';

const express = require('express');
const path    = require('path');

const config         = require('./config/env');
const requestLogger  = require('./middleware/requestLogger');
const errorHandler   = require('./middleware/errorHandler');
const healthRoutes   = require('./routes/health.routes');

const app = express();

// ── Body parsing ───────────────────────────────────────────────────────────
// Parse JSON request bodies. We enforce a maximum size here to guard
// against accidental or malicious oversized payloads.
app.use(express.json({ limit: config.maxPayloadBytes }));

// ── Request logging ────────────────────────────────────────────────────────
app.use(requestLogger);

// ── Static files (frontend dashboard) ─────────────────────────────────────
// Serving the public/ directory directly from Express is fine for
// development and a simple deployment. A CDN or Nginx would sit in
// front in production.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/health', healthRoutes);

// Additional route groups will be mounted here as phases progress:
// app.use('/api/v1/vehicles',   vehicleRoutes);
// app.use('/api/v1/ingest',     ingestionRoutes);
// app.use('/api/v1/telemetry',  telemetryRoutes);
// app.use('/api/v1/events',     eventRoutes);

// ── 404 handler ────────────────────────────────────────────────────────────
// Any request that reaches here did not match a registered route.
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { message: `Route not found: ${req.method} ${req.path}` },
  });
});

// ── Central error handler ──────────────────────────────────────────────────
// Must be registered last. Any middleware or route that calls next(err)
// will land here.
app.use(errorHandler);

module.exports = app;
