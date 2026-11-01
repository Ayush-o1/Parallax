'use strict';

const { Kafka, logLevel } = require('kafkajs');

function brokers() {
  const value = process.env.KAFKA_BROKERS || 'localhost:19092';
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function kafka() {
  return new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'parallax',
    brokers: brokers(),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8 },
  });
}

const topics = {
  telemetry: process.env.KAFKA_TELEMETRY_TOPIC || 'telemetry.normalized.v1',
  events: process.env.KAFKA_EVENTS_TOPIC || 'operational.events.v1',
};

let topicSetup;

async function ensureTopics(client) {
  // Publisher and consumer groups start together. Share one admin operation so
  // they cannot race each other while creating the same topics.
  if (topicSetup) return topicSetup;
  topicSetup = (async () => {
    const admin = client.admin();
    await admin.connect();
    try {
      const existing = new Set(await admin.listTopics());
      const missing = Object.values(topics).filter((topic) => !existing.has(topic));
      if (missing.length) await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((topic) => ({
          topic, numPartitions: Number(process.env.KAFKA_PARTITIONS || 3), replicationFactor: 1,
        })),
      });
    } finally {
      await admin.disconnect();
    }
  })();
  try {
    await topicSetup;
  } catch (error) {
    topicSetup = undefined;
    throw error;
  }
}

module.exports = { brokers, ensureTopics, kafka, topics };
