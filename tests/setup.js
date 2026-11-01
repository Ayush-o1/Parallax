'use strict';

// Load local defaults, then point both application config and Prisma at the
// test database before any test modules can import them. Never fall back to
// DATABASE_URL: database-backed tests must provide TEST_DATABASE_URL.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'test') {
  if (process.env.TEST_DATABASE_URL) {
    let databaseName;
    try {
      databaseName = new URL(process.env.TEST_DATABASE_URL).pathname.slice(1);
    } catch {
      throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL for parallax_test.');
    }
    if (databaseName !== 'parallax_test') {
      throw new Error('Refusing to run tests: TEST_DATABASE_URL must target parallax_test.');
    }
  }
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
}
