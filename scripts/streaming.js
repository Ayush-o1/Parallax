'use strict';

require('dotenv').config({ quiet: true });
const config = require('../src/config/env');
const logger = require('../src/utils/logger');
const { startPublisher } = require('../src/streaming/outboxPublisher');
const { startConsumer } = require('../src/streaming/eventConsumer');
const { startMetricsServer } = require('../src/observability/metricsServer');

config.validateConfig();
Promise.all([
  startPublisher(),
  startConsumer('parallax.realtime.v1'),
  startConsumer('parallax.analytics.v1'),
]).then((stoppers) => {
  const stopMetrics = startMetricsServer({ port: Number(process.env.STREAM_METRICS_PORT || 9466) });
  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received by stream workers`);
    await Promise.all([...stoppers.map((stopper) => stopper()), stopMetrics()]);
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}).catch((error) => {
  logger.error('Kafka stream worker startup failed; outbox remains durable', { message: error.message });
  process.exitCode = 1;
});
