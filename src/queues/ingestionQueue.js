'use strict';

const { Queue } = require('bullmq');
const config = require('../config/env');

function redisConnection() {
  if (!config.redisUrl) throw new Error('REDIS_URL is required for background ingestion.');
  const parsed = new URL(config.redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null,
  };
}

let queue;
function getIngestionQueue() {
  if (!queue) queue = new Queue('parallax.ingestion', {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
  return queue;
}

async function enqueueIngestion(requestId) {
  return getIngestionQueue().add('process-request', { requestId }, { jobId: `ingestion-${requestId}` });
}

async function closeQueue() {
  if (queue) await queue.close();
  queue = undefined;
}

module.exports = { closeQueue, enqueueIngestion, getIngestionQueue, redisConnection };
