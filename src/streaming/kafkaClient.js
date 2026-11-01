'use strict';

const { Kafka, logLevel } = require('kafkajs');
const config = require('../config/env');

function brokers() {
  const value = config.kafkaBrokers || 'localhost:19092';
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function kafka() {
  return new Kafka({
    clientId: config.kafkaClientId,
    brokers: brokers(),
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 300, retries: 8 },
  });
}

const topics = {
  telemetry: config.kafkaTelemetryTopic,
  events: config.kafkaEventsTopic,
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
          topic, numPartitions: config.kafkaPartitions, replicationFactor: 1,
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
