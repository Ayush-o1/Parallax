'use strict';

const { PrismaClient } = require('@prisma/client');

// Reuse one connection pool for the application process instead of creating
// a Prisma client per request.
const prisma = new PrismaClient();

module.exports = prisma;
