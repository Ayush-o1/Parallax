'use strict';

const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const asyncHandler = require('../utils/asyncHandler');
const rateLimit = require('express-rate-limit');
const config = require('../config/env');

const router = Router();
router.post('/token', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.tokenRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ success: false, error: {
    code: 'RATE_LIMITED', message: 'Too many token requests. Try again later.', requestId: req.reqId,
  } }),
}), asyncHandler(controller.token));

module.exports = router;
