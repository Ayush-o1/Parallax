'use strict';

const authService = require('../services/auth.service');

async function token(req, res) {
  const result = await authService.issueToken(req.body || {});
  return res.status(200).json({ success: true, data: result });
}

module.exports = { token };
