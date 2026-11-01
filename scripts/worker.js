'use strict';

require('dotenv').config({ quiet: true });
const config = require('../src/config/env');
const logger = require('../src/utils/logger');
const { startWorker } = require('../src/workers/ingestionWorker');
const { startMetricsServer } = require('../src/observability/metricsServer');

config.validateConfig();
let stop;
startWorker().then((shutdown) => {
  stop = shutdown;
  const stopMetrics = startMetricsServer({ port: config.workerMetricsPort });
  const exit = async (signal) => {
    logger.info(`${signal} received by worker`);
    await Promise.all([stop(), stopMetrics()]);
    process.exit(0);
  };
  process.on('SIGINT', () => exit('SIGINT'));
  process.on('SIGTERM', () => exit('SIGTERM'));
}).catch((error) => {
  logger.error('worker startup failed', { message: error.message });
  process.exitCode = 1;
});
