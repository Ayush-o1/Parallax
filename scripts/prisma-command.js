'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const config = require('../src/config/env');

// Migrations and seeds write to the database, so validate the target first.
// In test mode this rewrites DATABASE_URL to parallax_test before Prisma CLI
// starts; dev commands are restricted to parallax_dev.
config.validateConfig();
process.env.DATABASE_URL = config.databaseUrl;

const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error('Unable to start Prisma CLI:', result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
