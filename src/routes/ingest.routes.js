'use strict';

const { Router } = require('express');
const config = require('../config/env');
const rawBodyCapture = require('../middleware/rawBodyCapture');
const ingestController = require('../controllers/ingest.controller');
const organizationContext = require('../middleware/organizationContext');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();
router.post('/:source', organizationContext,
  rawBodyCapture(config.maxPayloadBytes),
  asyncHandler(ingestController.ingest));

module.exports = router;
