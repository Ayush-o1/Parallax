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
require('dotenv').config();

const config = {
  // Runtime environment. Controls log verbosity, error detail, etc.
  nodeEnv: process.env.NODE_ENV || 'development',

  // HTTP server port.
  port: parseInt(process.env.PORT || '3000', 10),

  // Primary PostgreSQL connection string used by Prisma at runtime.
  databaseUrl: process.env.DATABASE_URL,

  // Separate connection string used by the test runner so tests can
  // truncate tables safely without touching development data.
  testDatabaseUrl: process.env.TEST_DATABASE_URL,

  // Logging verbosity. Accepted: debug | info | warn | error
  logLevel: process.env.LOG_LEVEL || 'info',

  // Hard limit on incoming request body size. Express will reject
  // payloads larger than this before they reach a controller.
  maxPayloadBytes: parseInt(process.env.MAX_PAYLOAD_BYTES || '65536', 10),

  // Seconds without a new telemetry reading before a vehicle is
  // classified as stale / no-longer-reporting.
  staleVehicleThresholdSeconds: parseInt(
    process.env.STALE_VEHICLE_THRESHOLD_SECONDS || '300',
    10
  ),

  // Derived helpers.
  isDevelopment() {
    return this.nodeEnv === 'development';
  },
  isTest() {
    return this.nodeEnv === 'test';
  },
  isProduction() {
    return this.nodeEnv === 'production';
  },
};

/**
 * Validate that required values are present at startup.
 * Failing fast here is better than a cryptic error deep inside a service.
 */
function validateConfig() {
  const required = ['databaseUrl'];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in your values.'
    );
  }
}

validateConfig();

module.exports = config;
