'use strict';

const { Router } = require('express');
const controller = require('../controllers/telemetry.controller');
const organizationContext = require('../middleware/organizationContext');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();
router.use(organizationContext);
router.get('/summary', asyncHandler(controller.summary));
router.get('/telemetry/recent', asyncHandler(controller.recent));
router.get('/events/recent', asyncHandler(controller.recentEvents));
router.get('/ingestions', asyncHandler(controller.history));
router.get('/quarantine', asyncHandler(controller.quarantines));
router.get('/vehicles/:vehicleId/state', asyncHandler(controller.state));
router.get('/vehicles/:vehicleId/telemetry', asyncHandler(controller.telemetry));
router.get('/vehicles/:vehicleId/events', asyncHandler(controller.events));

module.exports = router;
