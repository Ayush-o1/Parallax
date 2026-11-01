/**
 * src/routes/health.routes.js
 *
 * Mounts the /health endpoint.
 *
 * Routes are kept separate from controllers because:
 *   - Routes define the URL surface area and which middleware applies.
 *   - Controllers contain the handler logic.
 * This separation makes it easy to add authentication middleware or
 * rate limiting to a route without touching the handler.
 */

'use strict';

const { Router } = require('express');
const { getHealth } = require('../controllers/health.controller');

const router = Router();

// No authentication required — health checks must be reachable by
// infrastructure probes that do not carry credentials.
router.get('/', getHealth);

module.exports = router;
