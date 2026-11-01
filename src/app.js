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
 *   1. Request logging — before parsing so malformed requests are captured.
 *   2. Body parsing — must come before any route that reads req.body.
 *   3. Routes — the actual application endpoints.
 *   4. 404 handler — catches any request that did not match a route.
 *   5. Error handler — must be LAST; Express identifies it by its 4-arg signature.
 */

'use strict';

const express = require('express');
const path    = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('node:crypto');

const config         = require('./config/env');
const requestLogger  = require('./middleware/requestLogger');
const errorHandler   = require('./middleware/errorHandler');
const healthRoutes   = require('./routes/health.routes');
const vehicleRoutes  = require('./routes/vehicle.routes');
const ingestionRoutes = require('./routes/ingest.routes');
const telemetryRoutes = require('./routes/telemetry.routes');
const authRoutes = require('./routes/auth.routes');
const { registry, requestMetrics } = require('./middleware/requestMetrics');

const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  connectSrc: ["'self'", 'ws:', 'wss:'],
} } }));

// ── Request logging ────────────────────────────────────────────────────────
// Register before body parsing so malformed and oversized JSON requests are
// captured too.
app.use(requestLogger);
app.use(requestMetrics);
app.use('/api/v1', rateLimit({ windowMs: 60_000, limit: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 1200), standardHeaders: true, legacyHeaders: false }));

// Ingestion captures raw bytes before JSON parsing or content decompression.
app.use('/api/v1/ingest', ingestionRoutes);

// Parse JSON for the regular API after the raw-ingestion route is mounted.
app.use(express.json({ limit: config.maxPayloadBytes }));

// ── Static files (frontend dashboard) ─────────────────────────────────────
// Serving the public/ directory directly from Express is fine for
// development and a simple deployment. A CDN or Nginx would sit in
// front in production.
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/vehicles', vehicleRoutes);
app.use('/api/v1', telemetryRoutes);
app.get('/metrics', async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const expected = process.env.METRICS_TOKEN || '';
    const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(supplied);
    if (!expected || expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      return res.status(404).end();
    }
  }
  try {
    res.set('Content-Type', registry.contentType);
    return res.send(await registry.metrics());
  } catch (error) { return next(error); }
});

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
