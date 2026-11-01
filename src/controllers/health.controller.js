'use strict';

const config = require('../config/env');
const packageInfo = require('../../package.json');
const prisma = require('../db/prisma');
const Redis = require('ioredis');

let redisClient;
function getRedis() {
  if (!config.redisUrl) return null;
  if (!redisClient) redisClient = new Redis(config.redisUrl, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 0,
    retryStrategy: (attempt) => attempt <= 1 ? 250 : null,
  });
  return redisClient;
}

function getHealth(req, res) {
  return res.status(200).json({ success: true, data: {
    status: 'ok', service: 'parallax', version: packageInfo.version,
    nodeEnv: config.nodeEnv, uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  } });
}

async function getReadiness(req, res) {
  const checks = { database: 'ok' };
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks.database = 'unavailable';
  }
  const redis = getRedis();
  if (config.isProduction() && !redis) checks.redis = 'not_configured';
  else if (redis) {
    try {
      if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
      await redis.ping();
      checks.redis = 'ok';
      if (config.isProduction()) {
        checks.worker = await redis.get('parallax:worker:heartbeat') ? 'ok' : 'unavailable';
      }
    } catch {
      checks.redis = 'unavailable';
    }
  }
  const ready = Object.values(checks).every((status) => status === 'ok');
  return res.status(ready ? 200 : 503).json({ success: ready, data: {
    status: ready ? 'ready' : 'not_ready', service: 'parallax', checks,
    timestamp: new Date().toISOString(),
  } });
}

module.exports = { getHealth, getReadiness };
