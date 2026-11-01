'use strict';

const { Queue, Worker } = require('bullmq');
const config = require('../config/env');
const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const { redisConnection } = require('../queues/ingestionQueue');
const ingestionService = require('../services/ingestion.service');
const realtimeHub = require('../realtime/hub');
const { queueJobs, queueWait } = require('../middleware/requestMetrics');
const Redis = require('ioredis');

const QUEUE_NAME = 'parallax.ingestion';
const DEAD_LETTER_QUEUE = 'parallax.ingestion.dead-letter';

async function detectStaleVehicles() {
  const states = await prisma.vehicleState.findMany({
    include: { vehicle: true, latestReading: { select: { externalEventId: true } } },
  });
  const now = new Date();
  let created = 0;
  for (const state of states) {
    const interval = config.oemReportingIntervals[state.vehicle.source]
      ? config.staleThresholdFor(state.vehicle.source) : config.staleVehicleFallbackSeconds;
    const staleAt = new Date(state.lastEventTime.getTime() + interval * 1000);
    if (now <= staleAt) continue;
    const key = `VEHICLE_STALE:${state.vehicleId}:${state.vehicle.source}:${state.latestReading.externalEventId}`;
    const result = await prisma.$transaction(async (tx) => {
      const inserted = await tx.derivedEvent.createMany({
        data: [{
          vehicleId: state.vehicleId,
          eventType: 'VEHICLE_STALE',
          severity: 'WARNING',
          dedupeKey: key,
          occurredAt: staleAt,
          explanation: `No newer telemetry arrived within the ${interval}-second reporting threshold.`,
        }], skipDuplicates: true,
      });
      if (inserted.count && config.streamingEnabled) await tx.outboxEvent.create({
        data: {
          organizationId: state.vehicle.organizationId,
          vehicleId: state.vehicleId,
          eventType: 'VEHICLE_STALE',
          eventKey: `operational:${key}`,
          payload: {
            schemaVersion: 1,
            organizationId: state.vehicle.organizationId,
            vehicleId: state.vehicleId,
            eventType: 'VEHICLE_STALE',
            severity: 'WARNING',
            occurredAt: staleAt.toISOString(),
            explanation: `No newer telemetry arrived within the ${interval}-second reporting threshold.`,
          },
        },
      });
      return inserted.count;
    });
    if (result) {
      created += result;
      realtimeHub.publish(state.vehicle.organizationId, 'operational.event.created', {
        vehicleId: state.vehicleId, eventType: 'VEHICLE_STALE', occurredAt: staleAt,
      });
    }
  }
  return created;
}

async function recoverPending(queue) {
  const pending = await prisma.ingestionRequest.findMany({
    where: { status: { in: ['RECEIVED', 'PROCESSING'] } },
    select: { id: true },
    orderBy: { receivedAt: 'asc' },
  });
  for (const request of pending) {
    const id = `ingestion-${request.id}`;
    const existing = await queue.getJob(id);
    if (existing) {
      const status = await existing.getState();
      if (['failed', 'completed'].includes(status)) await existing.remove();
      else continue;
    }
    await queue.add('process-request', { requestId: request.id }, { jobId: id });
  }
  return pending.length;
}

async function startWorker() {
  if (!config.redisUrl) throw new Error('Set REDIS_URL to start the background worker.');
  const heartbeat = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 3000 });
  const writeHeartbeat = () => heartbeat.set('parallax:worker:heartbeat', new Date().toISOString(), 'EX', 30)
    .catch((error) => logger.warn('worker heartbeat update failed', { message: error.message }));
  await writeHeartbeat();
  const heartbeatTimer = setInterval(writeHeartbeat, 10_000);
  heartbeatTimer.unref();
  const queue = new Queue(QUEUE_NAME, { connection: redisConnection() });
  const deadLetters = new Queue(DEAD_LETTER_QUEUE, { connection: redisConnection() });
  const worker = new Worker(QUEUE_NAME, async (job) => {
    queueWait.observe(Math.max(0, Date.now() - job.timestamp) / 1000);
    return ingestionService.processRequest(job.data.requestId);
  }, {
    connection: redisConnection(), concurrency: config.workerConcurrency,
    lockDuration: 30_000,
  });
  worker.on('completed', (job) => {
    queueJobs.inc({ result: 'completed' });
    logger.info('ingestion job completed', { jobId: job.id });
  });
  worker.on('failed', async (job, error) => {
    queueJobs.inc({ result: 'failed' });
    logger.error('ingestion job failed', { jobId: job?.id, attemptsMade: job?.attemptsMade, message: error.message });
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
      await deadLetters.add('failed-ingestion', {
        requestId: job.data.requestId, reason: error.message, failedAt: new Date().toISOString(), attempts: job.attemptsMade,
      }, { jobId: `dead-${job.data.requestId}`, removeOnComplete: false });
    }
  });
  worker.on('error', (error) => logger.error('ingestion worker error', { message: error.message }));
  const recovered = await recoverPending(queue);
  const staleTimer = setInterval(() => detectStaleVehicles().catch((error) => logger.error('stale vehicle scan failed', { message: error.message })), 15_000);
  logger.info('ingestion worker started', { concurrency: worker.opts.concurrency, recovered });
  return async () => {
    clearInterval(staleTimer);
    clearInterval(heartbeatTimer);
    await worker.close();
    await queue.close();
    await deadLetters.close();
    await heartbeat.del('parallax:worker:heartbeat');
    await heartbeat.quit();
    await prisma.$disconnect();
  };
}

module.exports = { detectStaleVehicles, recoverPending, startWorker };
