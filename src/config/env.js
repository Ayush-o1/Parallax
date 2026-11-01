/**
 * src/config/env.js
 *
 * Single source of truth for all environment-driven configuration.
 *
 * Why this exists:
 *   Reading process.env directly throughout the codebase scatters
 *   configuration and makes it easy to misspell a key or forget a
 *   default. Centralising it here means every other module imports
 *   typed, defaulted values from one place, and this file is the
 *   only place we ever call process.env.
 *
 * Database isolation:
 *   The test runner sets DATABASE_URL to TEST_DATABASE_URL before tests
 *   load application code. This also protects Prisma, which reads the
 *   environment variable directly. Test config never falls back to the
 *   development database.
 *
 * Unit-test safety:
 *   Unit tests that do not reach the database (adapters, validators,
 *   converters) import modules that never require config.databaseUrl.
 *   The startup validator skips the DATABASE_URL check in the test
 *   environment because the test suite bootstraps the connection
 *   separately via a dedicated db helper.
 *
 * Usage:
 *   const config = require('./config/env');
 *   console.log(config.port);
 */

'use strict';

// Load .env file in development and test environments.
// In production, environment variables are injected by the platform
// (Docker, Kubernetes, etc.) and dotenv is not needed.
// We use dotenv.config() at the very top of the config module so that
// every other module that imports config gets the correct values.
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ quiet: true });
}

const isTestEnv = (process.env.NODE_ENV || 'development') === 'test';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const config = {
  // Runtime environment. Controls log verbosity, error detail, etc.
  nodeEnv: process.env.NODE_ENV || 'development',

  // HTTP server port.
  port: parseInt(process.env.PORT || '3000', 10),

  // Active database connection string.
  // In test environments we automatically use TEST_DATABASE_URL so
  // that integration tests never touch the development database.
  // This is enforced here rather than in individual test files so
  // the protection cannot be accidentally bypassed.
  databaseUrl: isTestEnv ? (testDatabaseUrl || undefined) : process.env.DATABASE_URL,

  // Separate connection string used by the test runner.
  // Kept as a separate property so test helpers can reference it directly.
  testDatabaseUrl: process.env.TEST_DATABASE_URL,

  // Logging verbosity. Accepted: debug | info | warn | error
  logLevel: process.env.LOG_LEVEL || 'info',

  // Hard limit on incoming request body size. Express will reject
  // payloads larger than this before they reach a controller.
  maxPayloadBytes: parseInt(process.env.MAX_PAYLOAD_BYTES || '65536', 10),

  // ── Stale vehicle detection ─────────────────────────────────────────────
  // Per-OEM expected reporting intervals (seconds).
  // Used to determine whether a vehicle is actively connected.
  // A vehicle is stale when: now - lastReceivedAt > (interval * staleFactor).
  oemReportingIntervals: {
    OEM_ALPHA: parseInt(process.env.OEM_ALPHA_INTERVAL_SECONDS || '30', 10),
    OEM_BETA:  parseInt(process.env.OEM_BETA_INTERVAL_SECONDS  || '60', 10),
    OEM_GAMMA: parseInt(process.env.OEM_GAMMA_INTERVAL_SECONDS || '15', 10),
  },

  // Multiplier applied to the OEM's expected interval before a vehicle
  // is declared stale. A factor of 3 means: if Alpha normally reports
  // every 30 s, we allow up to 90 s of silence before marking it stale.
  // This prevents spurious stale alerts caused by momentary connectivity
  // gaps or minor scheduling drift in the OEM's telemetry client.
  staleVehicleFactor: parseFloat(process.env.STALE_VEHICLE_FACTOR || '3'),

  // Absolute fallback threshold (seconds) when source reporting frequency
  // is unknown. Unlike known OEMs, this value is not multiplied by the factor.
  staleVehicleFallbackSeconds: parseInt(
    process.env.STALE_VEHICLE_FALLBACK_SECONDS || '300',
    10
  ),

  // ── Timestamp acceptance window ─────────────────────────────────────────
  // Maximum age of an event's eventTime (seconds). Events older than
  // this are quarantined as TIMESTAMP_OUT_OF_RANGE.
  maxEventAgePastSeconds: parseInt(
    process.env.MAX_EVENT_AGE_PAST_SECONDS || '86400', // 24 hours
    10
  ),

  // Maximum clock skew ahead of server time (seconds). Events with
  // eventTime more than this far in the future are quarantined.
  maxEventAgeFutureSeconds: parseInt(
    process.env.MAX_EVENT_AGE_FUTURE_SECONDS || '300', // 5 minutes
    10
  ),

  // ── Derived event thresholds ────────────────────────────────────────────
  // Minimum speed (km/h) to consider a vehicle in motion (trip start).
  tripStartSpeedKph: parseFloat(process.env.TRIP_START_SPEED_KPH || '5'),

  // Duration (seconds) a vehicle must remain below tripStartSpeedKph
  // before a trip-end event is triggered.
  tripEndStationarySeconds: parseInt(
    process.env.TRIP_END_STATIONARY_SECONDS || '120',
    10
  ),

  // Duration (seconds) a vehicle must be stationary with engine on
  // before an excessive-idling event fires.
  idlingThresholdSeconds: parseInt(
    process.env.IDLING_THRESHOLD_SECONDS || '180',
    10
  ),

  // Derived helpers.
  isDevelopment() { return this.nodeEnv === 'development'; },
  isTest()        { return this.nodeEnv === 'test'; },
  isProduction()  { return this.nodeEnv === 'production'; },

  /**
   * Returns the stale threshold (seconds) for a given OEM source.
   * Avoids scattering this arithmetic throughout services.
   *
   * @param {string} source - e.g. 'OEM_ALPHA'
   * @returns {number} seconds
   */
  staleThresholdFor(source) {
    const interval = this.oemReportingIntervals[source];
    return interval === undefined
      ? this.staleVehicleFallbackSeconds
      : interval * this.staleVehicleFactor;
  },
};

/**
 * Validate that required values are present at startup.
 * Failing fast here is better than a cryptic error deep inside a service.
 *
 * Validation is explicit and called by the server entry point, rather than
 * running while unrelated modules import this configuration. In test mode,
 * a database URL is required only when a process actually starts the server;
 * ordinary unit tests can import config without database credentials.
 *
 * In the test environment we validate TEST_DATABASE_URL (never DATABASE_URL)
 * because:
 *   1. Unit tests (adapters, validators) never open a database connection.
 *   2. Integration tests configure the connection themselves via the
 *      TEST_DATABASE_URL after NODE_ENV=test has been confirmed.
 *
 * Requiring DATABASE_URL in tests would force every unit test to set
 * an env variable before importing any module that transitively imports
 * config, which is both inconvenient and architecturally wrong.
 */
function validateConfig() {
  const required = [isTestEnv ? 'testDatabaseUrl' : 'databaseUrl'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in your values.'
    );
  }

  const activeDatabaseUrl = isTestEnv ? config.testDatabaseUrl : config.databaseUrl;
  const expectedDatabase = isTestEnv ? 'parallax_test' : 'parallax_dev';
  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(activeDatabaseUrl);
  } catch {
    throw new Error(`${isTestEnv ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} must be a valid PostgreSQL URL for ${expectedDatabase}.`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol) || parsedDatabaseUrl.pathname.slice(1) !== expectedDatabase) {
    throw new Error(`${isTestEnv ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} must point exclusively to the ${expectedDatabase} database.`);
  }

  const positiveSettings = {
    PORT: config.port,
    MAX_PAYLOAD_BYTES: config.maxPayloadBytes,
    OEM_ALPHA_INTERVAL_SECONDS: config.oemReportingIntervals.OEM_ALPHA,
    OEM_BETA_INTERVAL_SECONDS: config.oemReportingIntervals.OEM_BETA,
    OEM_GAMMA_INTERVAL_SECONDS: config.oemReportingIntervals.OEM_GAMMA,
    STALE_VEHICLE_FACTOR: config.staleVehicleFactor,
    STALE_VEHICLE_FALLBACK_SECONDS: config.staleVehicleFallbackSeconds,
    MAX_EVENT_AGE_PAST_SECONDS: config.maxEventAgePastSeconds,
    MAX_EVENT_AGE_FUTURE_SECONDS: config.maxEventAgeFutureSeconds,
    TRIP_START_SPEED_KPH: config.tripStartSpeedKph,
    TRIP_END_STATIONARY_SECONDS: config.tripEndStationarySeconds,
    IDLING_THRESHOLD_SECONDS: config.idlingThresholdSeconds,
  };
  const invalid = Object.entries(positiveSettings)
    .filter(([key, value]) => !Number.isFinite(value) || value <= 0 || (key === 'PORT' && value > 65535))
    .map(([key]) => key);
  if (invalid.length) {
    throw new Error(`Invalid environment variable values: ${invalid.join(', ')}.`);
  }
}

config.validateConfig = validateConfig;
module.exports = config;
