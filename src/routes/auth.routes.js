'use strict';

const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');
const rateLimit = require('express-rate-limit');

const router = Router();
router.post('/token', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }), asyncHandler(controller.token));

module.exports = router;
