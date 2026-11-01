'use strict';

const prisma = require('../db/prisma');
const logger = require('../utils/logger');
const hub = require('../realtime/hub');
const { kafka, ensureTopics, topics } = require('./kafkaClient');
const { consumerLag } = require('../middleware/requestMetrics');

async function startConsumer(groupId) {
  const client = kafka();
  await ensureTopics(client);
  const consumer = client.consumer({ groupId, allowAutoTopicCreation: false });
  await consumer.connect();
  await consumer.subscribe({ topics: Object.values(topics), fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const event = JSON.parse(message.value.toString('utf8'));
      if (!event.eventKey || !event.organizationId || !event.vehicleId) throw new Error('Stream record is missing its idempotency or tenant key.');
      const result = await prisma.kafkaInbox.createMany({
        data: [{
          consumerGroup: groupId,
          eventKey: event.eventKey,
          topic,
          partition,
          offset: BigInt(message.offset),
        }],
        skipDuplicates: true,
      });
      if (result.count === 0) return;
      // Consumers run with separate groups and tenant rooms. A replayed event
      // cannot emit a second update for the same group because inbox insert is unique.
      if (groupId === 'parallax.realtime.v1') {
        const outbound = topic === topics.telemetry ? 'telemetry.stream.received' : 'operational.event.streamed';
        hub.publish(event.organizationId, outbound, {
          vehicleId: event.vehicleId, eventKey: event.eventKey, eventType: event.eventType || event.source,
          eventTime: event.eventTime || event.occurredAt,
        });
      }
    },
  });
  const updateLag = async () => {
    const admin = client.admin();
    await admin.connect();
    try {
      const committed = await admin.fetchOffsets({ groupId, topics: Object.values(topics) });
      for (const topic of Object.values(topics)) {
        const ends = await admin.fetchTopicOffsets(topic);
        const groupTopic = committed.find((entry) => entry.topic === topic);
        for (const end of ends) {
          const current = groupTopic?.partitions.find((entry) => entry.partition === end.partition);
          const offset = Number(current?.offset ?? -1);
          const lag = Math.max(0, Number(end.high) - (offset < 0 ? 0 : offset));
          consumerLag.set({ consumer_group: groupId, topic, partition: String(end.partition) }, lag);
        }
      }
    } finally {
      await admin.disconnect();
    }
  };
  const lagTimer = setInterval(() => updateLag().catch((error) => {
    logger.warn('Kafka consumer lag refresh failed', { groupId, message: error.message });
  }), 15_000);
  lagTimer.unref();
  updateLag().catch((error) => logger.warn('Kafka consumer lag refresh failed', { groupId, message: error.message }));
  logger.info('Kafka consumer group started', { groupId, topics: Object.values(topics) });
  return async () => {
    clearInterval(lagTimer);
    await consumer.disconnect();
  };
}

module.exports = { startConsumer };
