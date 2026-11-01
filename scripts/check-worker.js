'use strict';

const Redis = require('ioredis');

async function main() {
  if (!process.env.REDIS_URL) process.exit(1);
  const redis = new Redis(process.env.REDIS_URL, { connectTimeout: 1500, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try {
    const value = await redis.get('parallax:worker:heartbeat');
    process.exitCode = value ? 0 : 1;
  } catch {
    process.exitCode = 1;
  } finally {
    await redis.quit();
  }
}

main();
