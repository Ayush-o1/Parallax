/**
 * src/controllers/health.controller.js
 *
 * Handles the /health endpoint.
 *
 * A health endpoint serves two audiences:
 *   1. Load balancers and orchestrators (Kubernetes, Docker) that need
 *      a quick liveness check — "is the process running?"
 *   2. Developers and monitoring tools that want a richer readiness
 *      check — "is the process capable of serving traffic?"
 *
 * We implement a single /health route that returns basic process
 * information now. In later phases, when we have a database
 * connection, we will extend this to check DB reachability and
 * return a 503 if it is unavailable.
 */

'use strict';

const config = require('../config/env');

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
      version:   process.env.npm_package_version || '0.1.0',
      nodeEnv:   config.nodeEnv,
      // Uptime in seconds — useful for detecting recent restarts.
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = { getHealth };
