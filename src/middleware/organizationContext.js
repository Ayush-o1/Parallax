'use strict';

const config = require('../config/env');
const prisma = require('../db/prisma');
const AppError = require('../utils/AppError');

async function authenticate(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
  if (!match) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'A valid bearer token is required.');
  let claims;
  try {
    const { jwtVerify } = await import('jose');
    ({ payload: claims } = await jwtVerify(match[1], Buffer.from(config.tokenSigningSecret), { algorithms: ['HS256'] }));
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Bearer token is invalid or expired.');
  }
  const client = await prisma.apiClient.findFirst({ where: { id: claims.sub, revokedAt: null } });
  if (!client || client.organizationId !== claims.org) {
    throw new AppError(401, 'INVALID_TOKEN', 'Bearer token is invalid or revoked.');
  }
  req.organizationId = client.organizationId;
  req.apiClientId = client.id;
  req.apiClientRole = client.role;
  await prisma.apiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
}

async function organizationContext(req, res, next) {
  try {
    if (config.isProduction() || req.get('authorization')) {
      await authenticate(req);
    } else {
      const demo = await prisma.organization.findUnique({ where: { slug: 'demo' } });
      if (!demo) throw new AppError(503, 'DEMO_ORGANIZATION_NOT_SEEDED', 'Run the database seed before using local APIs.');
      req.organizationId = demo.id;
    }
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = organizationContext;
