'use strict';

const { PrismaClient } = require('@prisma/client');
const config = require('../src/config/env');

config.validateConfig();
// Prisma reads DATABASE_URL directly. Keep CLI seeding on the same validated
// target selected by config, especially when NODE_ENV=test.
process.env.DATABASE_URL = config.databaseUrl;

const prisma = new PrismaClient();

async function main() {
  await prisma.organization.upsert({
    where: { slug: 'demo' },
    create: {
      slug: 'demo',
      name: 'Parallax Demo',
      isDemo: true,
    },
    update: {
      name: 'Parallax Demo',
      isDemo: true,
    },
  });
}

main()
  .catch((error) => {
    console.error('Failed to seed the demo organization:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
