'use strict';

require('dotenv').config({ quiet: true });
const { defineConfig } = require('@playwright/test');

if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) !== 'parallax_test') {
  throw new Error('Browser tests require TEST_DATABASE_URL targeting the isolated parallax_test database.');
}

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3100', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/test-server.js',
    url: 'http://127.0.0.1:3100/health/live',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      PORT: '3100',
      REDIS_URL: '',
      KAFKA_BROKERS: '',
      STREAMING_ENABLED: 'false',
    },
  },
});
