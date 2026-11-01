'use strict';

const AppError = require('../utils/AppError');
const config = require('../config/env');

function requireRole(...allowed) {
  return (req, res, next) => {
    // Local unauthenticated demo mode is never enabled in production.
    if (!config.isProduction() && !req.apiClientRole) return next();
    if (!allowed.includes(req.apiClientRole)) {
      return next(new AppError(403, 'INSUFFICIENT_ROLE', 'This API client does not have permission for this operation.'));
    }
    return next();
  };
}

module.exports = requireRole;
