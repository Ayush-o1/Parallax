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
function integer(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number(raw);
}
function decimal(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}
function boolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true';
}

const config = {
  // Runtime environment. Controls log verbosity, error detail, etc.
  nodeEnv: process.env.NODE_ENV || 'development',

  // HTTP server port.
  port: integer('PORT', 3000),

  // Active database connection string.
  // In test environments we automatically use TEST_DATABASE_URL so
  // that integration tests never touch the development database.
  // This is enforced here rather than in individual test files so
  // the protection cannot be accidentally bypassed.
  databaseUrl: isTestEnv ? (testDatabaseUrl || undefined) : process.env.DATABASE_URL,

  // Separate connection string used by the test runner.
  // Kept as a separate property so test helpers can reference it directly.
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  accessTokenSeconds: integer('ACCESS_TOKEN_SECONDS', 3600),
  redisUrl: process.env.REDIS_URL,
  streamingEnabled: boolean('STREAMING_ENABLED', Boolean(process.env.KAFKA_BROKERS)),
  apiRateLimitPerMinute: integer('API_RATE_LIMIT_PER_MINUTE', 1200),
  tokenRateLimit: integer('TOKEN_RATE_LIMIT', 20),
  workerConcurrency: integer('WORKER_CONCURRENCY', 8),
  requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 30_000),
  headersTimeoutMs: integer('HEADERS_TIMEOUT_MS', 35_000),
  trustProxyHops: integer('TRUST_PROXY_HOPS', process.env.NODE_ENV === 'production' ? 1 : 0),
  maxBatchEvents: integer('MAX_BATCH_EVENTS', 500),
  dbConnectionLimit: integer('DB_CONNECTION_LIMIT', 10),
  dbPoolTimeoutSeconds: integer('DB_POOL_TIMEOUT_SECONDS', 10),
  dbConnectTimeoutSeconds: integer('DB_CONNECT_TIMEOUT_SECONDS', 5),
  tokenSigningSecret: process.env.TOKEN_SIGNING_SECRET
    || (process.env.NODE_ENV === 'production' ? undefined : 'parallax-local-only-token-signing-secret-change-me'),
  metricsToken: process.env.METRICS_TOKEN,
  workerMetricsPort: integer('WORKER_METRICS_PORT', 9465),
  streamMetricsPort: integer('STREAM_METRICS_PORT', 9466),
  kafkaBrokers: process.env.KAFKA_BROKERS,
  kafkaClientId: process.env.KAFKA_CLIENT_ID || 'parallax',
  kafkaPartitions: integer('KAFKA_PARTITIONS', 3),
  kafkaTelemetryTopic: process.env.KAFKA_TELEMETRY_TOPIC || 'telemetry.normalized.v1',
  kafkaEventsTopic: process.env.KAFKA_EVENTS_TOPIC || 'operational.events.v1',

  // Logging verbosity. Accepted: debug | info | warn | error
  logLevel: process.env.LOG_LEVEL || 'info',

  // Hard limit on incoming request body size. Express will reject
  // payloads larger than this before they reach a controller.
  maxPayloadBytes: integer('MAX_PAYLOAD_BYTES', 65536),

  // ── Stale vehicle detection ─────────────────────────────────────────────
  // Per-OEM expected reporting intervals (seconds).
  // Used to determine whether a vehicle is actively connected.
  // A vehicle is stale when: now - lastReceivedAt > (interval * staleFactor).
  oemReportingIntervals: {
    OEM_ALPHA: integer('OEM_ALPHA_INTERVAL_SECONDS', 30),
    OEM_BETA:  integer('OEM_BETA_INTERVAL_SECONDS', 60),
    OEM_GAMMA: integer('OEM_GAMMA_INTERVAL_SECONDS', 15),
  },

  // Multiplier applied to the OEM's expected interval before a vehicle
  // is declared stale. A factor of 3 means: if Alpha normally reports
  // every 30 s, we allow up to 90 s of silence before marking it stale.
  // This prevents spurious stale alerts caused by momentary connectivity
  // gaps or minor scheduling drift in the OEM's telemetry client.
  staleVehicleFactor: decimal('STALE_VEHICLE_FACTOR', 3),

  // Absolute fallback threshold (seconds) when source reporting frequency
  // is unknown. Unlike known OEMs, this value is not multiplied by the factor.
  staleVehicleFallbackSeconds: integer('STALE_VEHICLE_FALLBACK_SECONDS', 300),

  // ── Timestamp acceptance window ─────────────────────────────────────────
  // Maximum age of an event's eventTime (seconds). Events older than
  // this are quarantined as TIMESTAMP_OUT_OF_RANGE.
  maxEventAgePastSeconds: integer('MAX_EVENT_AGE_PAST_SECONDS', 86400),

  // Maximum clock skew ahead of server time (seconds). Events with
  // eventTime more than this far in the future are quarantined.
  maxEventAgeFutureSeconds: integer('MAX_EVENT_AGE_FUTURE_SECONDS', 300),

  // ── Derived event thresholds ────────────────────────────────────────────
  // Minimum speed (km/h) to consider a vehicle in motion (trip start).
  tripStartSpeedKph: decimal('TRIP_START_SPEED_KPH', 5),

  // Duration (seconds) a vehicle must remain below tripStartSpeedKph
  // before a trip-end event is triggered.
  tripEndStationarySeconds: integer('TRIP_END_STATIONARY_SECONDS', 120),

  // Duration (seconds) a vehicle must be stationary with engine on
  // before an excessive-idling event fires.
  idlingThresholdSeconds: integer('IDLING_THRESHOLD_SECONDS', 180),
  hardBrakingAccelMss: decimal('HARD_BRAKING_ACCEL_MSS', -3),

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
  const expectedDatabase = isTestEnv
    ? 'parallax_test'
    : config.isProduction() ? undefined : 'parallax_dev';
  const variableName = isTestEnv ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
  let parsedDatabaseUrl;
  try {
    parsedDatabaseUrl = new URL(activeDatabaseUrl);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL${expectedDatabase ? ` for ${expectedDatabase}` : ''}.`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error(`${variableName} must use the PostgreSQL protocol.`);
  }
  if (config.isProduction() && ['parallax_dev', 'parallax_test'].includes(parsedDatabaseUrl.pathname.slice(1))) {
    throw new Error('Production DATABASE_URL must not point to a development or test database.');
  }
  if (config.isProduction() && ['localhost', '127.0.0.1', '::1'].includes(parsedDatabaseUrl.hostname)) {
    throw new Error('Production DATABASE_URL must point to a reachable managed or private database host.');
  }
  if (expectedDatabase && parsedDatabaseUrl.pathname.slice(1) !== expectedDatabase) {
    throw new Error(`${variableName} must point exclusively to the ${expectedDatabase} database.`);
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
    ACCESS_TOKEN_SECONDS: config.accessTokenSeconds,
    API_RATE_LIMIT_PER_MINUTE: config.apiRateLimitPerMinute,
    TOKEN_RATE_LIMIT: config.tokenRateLimit,
    WORKER_CONCURRENCY: config.workerConcurrency,
    REQUEST_TIMEOUT_MS: config.requestTimeoutMs,
    HEADERS_TIMEOUT_MS: config.headersTimeoutMs,
    MAX_BATCH_EVENTS: config.maxBatchEvents,
    DB_CONNECTION_LIMIT: config.dbConnectionLimit,
    DB_POOL_TIMEOUT_SECONDS: config.dbPoolTimeoutSeconds,
    DB_CONNECT_TIMEOUT_SECONDS: config.dbConnectTimeoutSeconds,
    WORKER_METRICS_PORT: config.workerMetricsPort,
    STREAM_METRICS_PORT: config.streamMetricsPort,
    KAFKA_PARTITIONS: config.kafkaPartitions,
  };
  const invalid = Object.entries(positiveSettings)
    .filter(([key, value]) => !Number.isFinite(value) || value <= 0 || (key === 'PORT' && value > 65535))
    .map(([key]) => key);
  if (invalid.length) {
    throw new Error(`Invalid environment variable values: ${invalid.join(', ')}.`);
  }
  if (!Number.isInteger(config.trustProxyHops) || config.trustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
  }
  if (config.isProduction() && (!config.tokenSigningSecret || Buffer.byteLength(config.tokenSigningSecret) < 32)) {
    throw new Error('TOKEN_SIGNING_SECRET must be at least 32 bytes in production.');
  }
  if (config.isProduction()) {
    const missingProduction = [];
    if (!config.redisUrl) missingProduction.push('REDIS_URL');
    if (!config.metricsToken || Buffer.byteLength(config.metricsToken) < 32) missingProduction.push('METRICS_TOKEN (at least 32 bytes)');
    if (process.env.STREAMING_ENABLED === undefined) missingProduction.push('STREAMING_ENABLED (set true or false explicitly)');
    if (missingProduction.length) throw new Error(`Missing production security/runtime configuration: ${missingProduction.join(', ')}.`);
    if (config.redisUrl) {
      let parsedRedisUrl;
      try { parsedRedisUrl = new URL(config.redisUrl); } catch { throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.'); }
      if (!['redis:', 'rediss:'].includes(parsedRedisUrl.protocol)) throw new Error('REDIS_URL must use redis:// or rediss://.');
    }
    if (config.streamingEnabled && !config.kafkaBrokers) throw new Error('KAFKA_BROKERS is required when STREAMING_ENABLED=true.');
    if (config.streamingEnabled && config.kafkaPartitions < 1) throw new Error('KAFKA_PARTITIONS must be a positive integer.');
  }
  if (process.env.STREAMING_ENABLED !== undefined && !['true', 'false'].includes(process.env.STREAMING_ENABLED)) {
    throw new Error('STREAMING_ENABLED must be true or false.');
  }
  if (config.headersTimeoutMs <= config.requestTimeoutMs) {
    throw new Error('HEADERS_TIMEOUT_MS must be greater than REQUEST_TIMEOUT_MS.');
  }
}

config.validateConfig = validateConfig;
module.exports = config;
