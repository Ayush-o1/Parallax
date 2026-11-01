'use strict';

const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const { kafka, ensureTopics, topics } = require('./kafkaClient');
const { kafkaOutboxEvents, outboxPending } = require('../middleware/requestMetrics');

const BATCH_SIZE = 100;
const LEASE_MS = 30_000;

async function claimBatch() {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const rows = await tx.$queryRaw`
      SELECT id, vehicle_id, event_type, event_key, payload, attempts
      FROM outbox_events
      WHERE published_at IS NULL AND available_at <= ${now}
        AND (claimed_until IS NULL OR claimed_until < ${now})
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    `;
    if (rows.length) {
      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { claimedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
      });
    }
    return rows.map((row) => ({ ...row, attempts: row.attempts + 1 }));
  });
}

async function markPublished(id) {
  await prisma.outboxEvent.update({ where: { id }, data: { publishedAt: new Date(), claimedUntil: null, lastError: null } });
}

async function releaseForRetry(row, error) {
  const waitMs = Math.min(60_000, 500 * (2 ** Math.min(row.attempts, 7)));
  await prisma.outboxEvent.update({
    where: { id: row.id },
    data: {
      claimedUntil: null,
      availableAt: new Date(Date.now() + waitMs),
      lastError: String(error.message || error).slice(0, 1000),
    },
  });
}

async function publishRow(producer, row) {
  const topic = row.event_type === 'TELEMETRY_NORMALIZED' ? topics.telemetry : topics.events;
  await producer.send({
    topic,
    acks: -1,
    messages: [{ key: row.vehicle_id, value: JSON.stringify({ eventKey: row.event_key, eventType: row.event_type, ...row.payload }), timestamp: String(Date.now()) }],
  });
  await markPublished(row.id);
}

async function startPublisher({ pollMs = 500 } = {}) {
  const client = kafka();
  await ensureTopics(client);
  const producer = client.producer({ allowAutoTopicCreation: false, idempotent: true, maxInFlightRequests: 1 });
  await producer.connect();
  let stopped = false;
  const loop = async () => {
    while (!stopped) {
      try {
        const rows = await claimBatch();
        if (!rows.length) {
          outboxPending.set(await prisma.outboxEvent.count({ where: { publishedAt: null } }));
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          continue;
        }
        for (const row of rows) {
          try { await publishRow(producer, row); kafkaOutboxEvents.inc({ result: 'published' }); }
          catch (error) {
            kafkaOutboxEvents.inc({ result: 'failed' });
            await releaseForRetry(row, error);
            logger.error('outbox publish failed; row scheduled for retry', { eventKey: row.event_key, message: error.message });
          }
        }
        outboxPending.set(await prisma.outboxEvent.count({ where: { publishedAt: null } }));
      } catch (error) {
        logger.error('outbox poll failed', { message: error.message });
        await new Promise((resolve) => setTimeout(resolve, pollMs * 4));
      }
    }
  };
  const running = loop();
  logger.info('Kafka outbox publisher started', { topics: Object.values(topics) });
  return async () => {
    stopped = true;
    await running;
    await producer.disconnect();
  };
}

module.exports = { claimBatch, publishRow, startPublisher };
