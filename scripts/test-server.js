'use strict';

if (!process.env.TEST_DATABASE_URL || new URL(process.env.TEST_DATABASE_URL).pathname.slice(1) !== 'parallax_test') {
  throw new Error('Refusing to start browser test server without isolated TEST_DATABASE_URL.');
}
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_URL = '';
process.env.KAFKA_BROKERS = '';
process.env.STREAMING_ENABLED = 'false';
require('../src/server');
