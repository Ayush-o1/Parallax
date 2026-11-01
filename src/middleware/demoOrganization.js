'use strict';

const prisma = require('../db/prisma');
const config = require('../config/env');
const AppError = require('../utils/AppError');

/**
 * Resolve the local demo tenant without trusting a client-supplied org ID.
 * Production routes remain closed until credential-based authentication is
 * installed in Phase 9.
 */
async function demoOrganization(req, res, next) {
  if (config.isProduction()) {
    return next(new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.'));
  }

  try {
    const organization = await prisma.organization.findUnique({ where: { slug: 'demo' } });
    if (!organization) {
      return next(new AppError(503, 'DEMO_ORGANIZATION_NOT_SEEDED', 'Run the database seed before using local vehicle APIs.'));
    }
    req.organizationId = organization.id;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = demoOrganization;
