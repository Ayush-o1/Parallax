/**
 * src/controllers/health.controller.js
 *
 * Handles the /health endpoint.
 *
 * A health endpoint serves two audiences:
 *   1. Load balancers and orchestrators (Kubernetes, Docker) that need
 *      a quick liveness check — "is the process running?"
 *   2. Developers and monitoring tools that want basic process metadata.
 *
 * This is a liveness endpoint. Dependency health is reported by the
 * container health checks and service-specific metrics, not inferred here.
 */

'use strict';

const config = require('../config/env');
const packageInfo = require('../../package.json');

/**
 * GET /health
 *
 * Returns process liveness and basic runtime information.
 * Always returns 200 while the process is running.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
function getHealth(req, res) {
  res.status(200).json({
    success: true,
    data: {
      status:    'ok',
      service:   'parallax',
      version:   packageInfo.version,
      nodeEnv:   config.nodeEnv,
      // Uptime in seconds — useful for detecting recent restarts.
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = { getHealth };
