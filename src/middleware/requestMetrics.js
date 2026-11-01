'use strict';

const client = require('prom-client');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const requests = new client.Counter({
  name: 'parallax_http_requests_total', help: 'Completed HTTP requests.', labelNames: ['method', 'route', 'status'], registers: [registry],
});
const duration = new client.Histogram({
  name: 'parallax_http_request_duration_seconds', help: 'HTTP request duration in seconds.', labelNames: ['method', 'route'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5], registers: [registry],
});
const outboxPending = new client.Gauge({
  name: 'parallax_outbox_pending', help: 'Outbox rows awaiting broker publication.', registers: [registry],
});
const kafkaOutboxEvents = new client.Counter({
  name: 'parallax_outbox_publish_total', help: 'Outbox publication results.', labelNames: ['result'], registers: [registry],
});
const ingestionEvents = new client.Counter({
  name: 'parallax_ingestion_events_total', help: 'Telemetry event processing outcomes.', labelNames: ['status'], registers: [registry],
});
const queueJobs = new client.Counter({
  name: 'parallax_ingestion_jobs_total', help: 'BullMQ ingestion job outcomes.', labelNames: ['result'], registers: [registry],
});
const queueWait = new client.Histogram({
  name: 'parallax_ingestion_queue_wait_seconds', help: 'Time from BullMQ enqueue until worker pickup.',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30], registers: [registry],
});
const consumerLag = new client.Gauge({
  name: 'parallax_kafka_consumer_lag', help: 'Unconsumed Kafka messages by consumer group, topic, and partition.',
  labelNames: ['consumer_group', 'topic', 'partition'], registers: [registry],
});

function requestMetrics(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path === '/metrics' ? '/metrics' : 'unmatched';
    requests.inc({ method: req.method, route, status: String(res.statusCode) });
    duration.observe({ method: req.method, route }, Number(process.hrtime.bigint() - startedAt) / 1e9);
  });
  next();
}

module.exports = { consumerLag, ingestionEvents, kafkaOutboxEvents, outboxPending, queueJobs, queueWait, registry, requestMetrics };
