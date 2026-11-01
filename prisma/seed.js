'use strict';

const { PrismaClient } = require('@prisma/client');
const config = require('../src/config/env');

config.validateConfig();

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
