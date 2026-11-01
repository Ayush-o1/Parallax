'use strict';

const { Router } = require('express');
const vehicleController = require('../controllers/vehicle.controller');
const organizationContext = require('../middleware/organizationContext');
const asyncHandler = require('../utils/asyncHandler');

const router = Router();
router.use(organizationContext);
router.post('/', asyncHandler(vehicleController.register));
router.get('/', asyncHandler(vehicleController.list));
router.get('/:vehicleId', asyncHandler(vehicleController.get));
router.patch('/:vehicleId', asyncHandler(vehicleController.update));

module.exports = router;
