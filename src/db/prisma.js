'use strict';

const { PrismaClient } = require('@prisma/client');
const config = require('../config/env');

function withPoolSettings(rawUrl) {
  if (!rawUrl) return undefined;
  const url = new URL(rawUrl);
  if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', String(config.dbConnectionLimit));
  if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', String(config.dbPoolTimeoutSeconds));
  if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', String(config.dbConnectTimeoutSeconds));
  return url.toString();
}

// Reuse one connection pool for the application process instead of creating
// a Prisma client per request.
const prisma = new PrismaClient({
  datasources: { db: { url: withPoolSettings(config.databaseUrl) } },
});

module.exports = prisma;
