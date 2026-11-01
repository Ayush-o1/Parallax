/**
 * src/utils/logger.js
 *
 * Lightweight structured logger built on top of console.
 *
 * Why not a logging library yet?
 *   In Phase 0 we keep dependencies minimal. This logger is a thin
 *   wrapper that writes JSON lines to stdout, which is the correct
 *   format for cloud log aggregators. If we later decide to use
 *   pino or winston, this module is the only file that changes.
 *
 * Each log entry is a JSON object with:
 *   - timestamp  ISO 8601 UTC
 *   - level      debug | info | warn | error
 *   - message    human-readable description
 *   - ...rest    any additional context fields passed by the caller
 */

'use strict';

const config = require('../config/env');

// Numeric priority so we can compare levels without string switches.
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel = LEVELS[config.logLevel] ?? LEVELS.info;

/**
 * Write a structured log entry to stdout (info/debug) or stderr (warn/error).
 *
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {object} [context] - Additional key/value pairs to include.
 */
function log(level, message, context = {}) {
  if (LEVELS[level] < currentLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const line = JSON.stringify(entry);

  if (level === 'warn' || level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {
  debug: (message, context) => log('debug', message, context),
  info:  (message, context) => log('info',  message, context),
  warn:  (message, context) => log('warn',  message, context),
  error: (message, context) => log('error', message, context),
};

module.exports = logger;
