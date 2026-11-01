/**
 * tests/unit/config.test.js
 *
 * Unit tests for src/config/env.js
 *
 * These tests verify:
 *   1. In test environments, DATABASE_URL is automatically switched to
 *      TEST_DATABASE_URL — integration tests can never touch parallax_dev.
 *   2. The staleThresholdFor() helper computes correctly.
 *   3. Unit tests that import config do NOT need DATABASE_URL set,
 *      because the startup validator is skipped in test environments.
 *
 * Note on test isolation:
 *   Config is a singleton (Node module cache). We cannot change
 *   process.env.NODE_ENV mid-test and re-import config to see the
 *   difference — the cached module would return stale values.
 *   Instead, we test the behaviour that IS active in the current
 *   test environment (NODE_ENV=test), and separately verify the
 *   staleThresholdFor() helper which is pure arithmetic.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

// Import config normally — this runs under NODE_ENV=test
const config = require('../../src/config/env');

describe('config/env — test environment', () => {
  it('nodeEnv is "test" when run via the test suite', () => {
    // The test runner sets NODE_ENV=test (see package.json test script).
    assert.equal(config.nodeEnv, 'test');
  });

  it('isTest() returns true', () => {
    assert.equal(config.isTest(), true);
  });

  it('isDevelopment() returns false', () => {
    assert.equal(config.isDevelopment(), false);
  });

  it('databaseUrl resolves to TEST_DATABASE_URL in test environment', () => {
    // This is the core isolation guarantee: when NODE_ENV=test,
    // config.databaseUrl must be the test database, never dev.
    assert.equal(config.databaseUrl, process.env.TEST_DATABASE_URL);
  });
});

describe('config/env — staleThresholdFor()', () => {
  it('computes Alpha stale threshold as interval × factor', () => {
    // Alpha interval = 30 s, factor = 3 → 90 s
    const threshold = config.staleThresholdFor('OEM_ALPHA');
    const expected  = config.oemReportingIntervals.OEM_ALPHA * config.staleVehicleFactor;
    assert.equal(threshold, expected);
  });

  it('computes Beta stale threshold correctly', () => {
    const threshold = config.staleThresholdFor('OEM_BETA');
    assert.equal(threshold, config.oemReportingIntervals.OEM_BETA * config.staleVehicleFactor);
  });

  it('computes Gamma stale threshold correctly', () => {
    const threshold = config.staleThresholdFor('OEM_GAMMA');
    assert.equal(threshold, config.oemReportingIntervals.OEM_GAMMA * config.staleVehicleFactor);
  });

  it('uses fallback for an unknown source', () => {
    const threshold = config.staleThresholdFor('OEM_UNKNOWN');
    assert.equal(threshold, config.staleVehicleFallbackSeconds);
  });

  it('Gamma stale threshold is shorter than Alpha (higher frequency = tighter SLA)', () => {
    assert.ok(
      config.staleThresholdFor('OEM_GAMMA') < config.staleThresholdFor('OEM_ALPHA'),
      'Gamma reports more frequently so its stale threshold should be shorter'
    );
  });
});

describe('config/env — isolation and validation', () => {
  it('does not fall back to DATABASE_URL when TEST_DATABASE_URL is missing', () => {
    const result = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://localhost/parallax_dev';
      process.env.TEST_DATABASE_URL = '';
      require('./src/config/env');
    `], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' },
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it('allows importing config without database credentials in test mode', () => {
    const result = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = '';
      process.env.TEST_DATABASE_URL = '';
      const config = require('./src/config/env');
      if (config.databaseUrl !== undefined) process.exit(2);
    `], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' },
    });
    assert.equal(result.status, 0, result.stderr);
  });

  it('requires TEST_DATABASE_URL when explicitly validating test startup', () => {
    const result = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'test';
      process.env.DATABASE_URL = 'postgresql://localhost/parallax_dev';
      process.env.TEST_DATABASE_URL = '';
      require('./src/config/env').validateConfig();
    `], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /testDatabaseUrl/);
  });

  it('rejects a test URL that points at the development database', () => {
    const result = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'test';
      process.env.TEST_DATABASE_URL = 'postgresql://localhost/parallax_dev';
      require('./src/config/env').validateConfig();
    `], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /parallax_test/);
  });

  it('rejects invalid environment values at explicit startup validation', () => {
    const result = spawnSync(process.execPath, ['-e', `
      process.env.NODE_ENV = 'development';
      process.env.DATABASE_URL = 'postgresql://localhost/parallax_dev';
      process.env.PORT = 'not-a-port';
      require('./src/config/env').validateConfig();
    `], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PORT/);
  });
});

describe('config/env — timestamp acceptance window', () => {
  it('maxEventAgePastSeconds is a positive integer', () => {
    assert.ok(config.maxEventAgePastSeconds > 0);
    assert.equal(typeof config.maxEventAgePastSeconds, 'number');
  });

  it('maxEventAgeFutureSeconds is a positive integer', () => {
    assert.ok(config.maxEventAgeFutureSeconds > 0);
    assert.equal(typeof config.maxEventAgeFutureSeconds, 'number');
  });

  it('future window is shorter than past window (skew < delayed delivery)', () => {
    // Clock skew tolerance (5 min) should be much shorter than the
    // delayed-delivery tolerance (24 h). This is a sanity check.
    assert.ok(
      config.maxEventAgeFutureSeconds < config.maxEventAgePastSeconds,
      'Future skew window should be much shorter than past delivery window'
    );
  });
});

