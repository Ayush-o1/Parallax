'use strict';

require('dotenv').config({ quiet: true });
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const baseUrl = process.env.BENCH_URL || 'http://localhost:3000';
const targetEvents = Number(process.env.BENCH_EVENTS || 1000);
const concurrency = Number(process.env.BENCH_CONCURRENCY || 16);
const groupSize = Number(process.env.BENCH_BATCH_SIZE || 25);
const samples = { direct: [], batch: [], duplicate: [], vehicleList: [], vehicleDetail: [], overview: [], reads: [] };
const requestCounts = { total: 0, successful: 0, failed: 0 };
const requestIds = [];
const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const vin = [...crypto.randomBytes(17)].map((byte) => chars[byte % chars.length]).join('');
const quantile = (values, percentile) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))] || 0;
};

async function call(url, { token, method = 'GET', body } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const started = performance.now();
  const response = await fetch(`${baseUrl}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  requestCounts.total += 1;
  if (response.ok) requestCounts.successful += 1;
  else requestCounts.failed += 1;
  return { status: response.status, result, ms: performance.now() - started };
}

function event(sequence, baseTime) {
  return {
    vin,
    speed: 40 + (sequence % 50), speed_unit: 'mph',
    odometer: 15_000 + sequence / 100,
    latitude: 12.9716, longitude: 77.5946, fuel_level: 70,
    engine_on: true, event_id: `BENCH-${sequence}-${crypto.randomUUID()}`,
    timestamp: new Date(baseTime + sequence).toISOString(),
  };
}

async function run() {
  if (!Number.isInteger(targetEvents) || targetEvents < 1 || targetEvents > 50_000) throw new Error('BENCH_EVENTS must be 1..50000.');
  const organization = await prisma.organization.create({ data: { slug: `bench-${crypto.randomUUID()}`, name: 'Parallax benchmark fixture' } });
  const clientId = `bench-${crypto.randomUUID()}`;
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const client = await prisma.apiClient.create({ data: {
    organizationId: organization.id, name: 'temporary benchmark client', clientId,
    secretHash: await bcrypt.hash(clientSecret, 4),
    role: 'ADMIN',
  } });
  let vehicle;
  try {
    const auth = await call('/api/v1/auth/token', { method: 'POST', body: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret } });
    if (auth.status !== 200) throw new Error(`Auth failed: ${auth.status}`);
    const token = auth.result.data.access_token;
    const created = await call('/api/v1/vehicles', { token, method: 'POST', body: { vin, source: 'OEM_ALPHA' } });
    if (created.status !== 201) throw new Error(`Vehicle registration failed: ${created.status} ${JSON.stringify(created.result.error || {})}`);
    vehicle = await prisma.vehicle.findFirstOrThrow({ where: { organizationId: organization.id, vin } });
    const baseTime = Date.now() - 10_000;

    // Direct mode measures per-request work and runs bounded parallel writers.
    let next = 1;
    const directStarted = performance.now();
    async function directWorker() {
      while (true) {
        const sequence = next++;
        if (sequence > targetEvents) return;
        const result = await call('/api/v1/ingest/OEM_ALPHA', { token, method: 'POST', body: event(sequence, baseTime) });
        samples.direct.push(result.ms);
        if (![200, 202, 207].includes(result.status)) throw new Error(`Direct ingest failed: ${result.status}`);
        if (result.result.data?.requestId) requestIds.push(result.result.data.requestId);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, directWorker));
    const directDurationMs = performance.now() - directStarted;

    // Batch mode uses a disjoint event range to measure multi-event receipt cost.
    const batchStarted = performance.now();
    for (let start = targetEvents + 1; start <= targetEvents * 2; start += groupSize) {
      const payload = Array.from({ length: Math.min(groupSize, targetEvents * 2 - start + 1) }, (_, index) => event(start + index, baseTime));
      const result = await call('/api/v1/ingest/OEM_ALPHA', { token, method: 'POST', body: payload });
      samples.batch.push(result.ms);
      if (![200, 202, 207].includes(result.status)) throw new Error(`Batch ingest failed: ${result.status}`);
      if (result.result.data?.requestId) requestIds.push(result.result.data.requestId);
    }
    const batchDurationMs = performance.now() - batchStarted;

    // Resend a known event by retrieving it from the first request's stored JSON body.
    const firstRequest = await prisma.ingestionRequest.findFirst({ where: { organizationId: organization.id }, orderBy: { receivedAt: 'asc' } });
    const firstEvent = await prisma.ingestionEvent.findFirst({ where: { requestId: firstRequest.id }, orderBy: { ordinal: 'asc' } });
    const duplicate = await call('/api/v1/ingest/OEM_ALPHA', { token, method: 'POST', body: firstEvent.payload });
    samples.duplicate.push(duplicate.ms);
    if (duplicate.result.data?.requestId) requestIds.push(duplicate.result.data.requestId);

    // Poll API-backed historical reads for both a current page and a cursor page.
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const result = await call(`/api/v1/vehicles/${vehicle.id}/telemetry?${query}`, { token });
      samples.reads.push(result.ms);
      if (result.status !== 200) throw new Error(`History read failed: ${result.status}`);
      cursor = result.result.page.nextCursor;
      if (!cursor) break;
    }
    for (let sample = 0; sample < 20; sample += 1) {
      const list = await call('/api/v1/vehicles?limit=50', { token });
      if (list.status !== 200) throw new Error(`Vehicle list failed: ${list.status}`);
      samples.vehicleList.push(list.ms);
      const detail = await call(`/api/v1/vehicles/${vehicle.id}`, { token });
      if (detail.status !== 200) throw new Error(`Vehicle detail failed: ${detail.status}`);
      samples.vehicleDetail.push(detail.ms);
      const summary = await call('/api/v1/summary', { token });
      if (summary.status !== 200) throw new Error(`Dashboard overview failed: ${summary.status}`);
      samples.overview.push(summary.ms);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 120_000) {
      const unfinished = await prisma.ingestionRequest.count({ where: { id: { in: requestIds }, status: { in: ['RECEIVED', 'PROCESSING'] } } });
      if (!unfinished) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (await prisma.ingestionRequest.count({ where: { id: { in: requestIds }, status: { in: ['RECEIVED', 'PROCESSING'] } } })) {
      throw new Error('Ingestion requests did not finish before the 120-second benchmark timeout.');
    }

    if (process.env.KAFKA_BROKERS) {
      const outboxStartedAt = Date.now();
      while (Date.now() - outboxStartedAt < 60_000) {
        const outboxTotal = await prisma.outboxEvent.count({ where: { vehicleId: vehicle.id } });
        const unpublished = await prisma.outboxEvent.count({ where: { vehicleId: vehicle.id, publishedAt: null } });
        const consumers = await prisma.kafkaInbox.groupBy({
          by: ['consumerGroup'], where: { eventKey: { contains: vehicle.id } }, _count: { _all: true },
        });
        const counts = Object.fromEntries(consumers.map((row) => [row.consumerGroup, row._count._all]));
        if (unpublished === 0 && ['parallax.realtime.v1', 'parallax.analytics.v1'].every((group) => counts[group] === outboxTotal)) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const outboxTotal = await prisma.outboxEvent.count({ where: { vehicleId: vehicle.id } });
      const unpublished = await prisma.outboxEvent.count({ where: { vehicleId: vehicle.id, publishedAt: null } });
      const groups = await prisma.kafkaInbox.groupBy({
        by: ['consumerGroup'], where: { eventKey: { contains: vehicle.id } }, _count: { _all: true },
      });
      const counts = Object.fromEntries(groups.map((row) => [row.consumerGroup, row._count._all]));
      if (unpublished || ['parallax.realtime.v1', 'parallax.analytics.v1'].some((group) => counts[group] !== outboxTotal)) {
        throw new Error('Kafka outbox publishing or consumer inbox delivery did not catch up before the benchmark timeout.');
      }
    }

    const database = await prisma.$queryRaw`SELECT version() AS version`;
    const requestRows = await prisma.ingestionRequest.findMany({
      where: { organizationId: organization.id }, select: { receivedAt: true, completedAt: true, status: true },
    });
    const requestCompletion = requestRows.filter((row) => row.completedAt).map((row) => row.completedAt.getTime() - row.receivedAt.getTime());
    const ingestionStatusCounts = await prisma.ingestionEvent.groupBy({
      by: ['status'], where: { request: { organizationId: organization.id } }, _count: { _all: true },
    }).then((rows) => Object.fromEntries(rows.map((row) => [row.status, row._count._all])));
    const eventCount = Object.values(ingestionStatusCounts).reduce((total, count) => total + count, 0);
    const unsuccessfulCount = Object.entries(ingestionStatusCounts)
      .filter(([status]) => !['ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'DUPLICATE'].includes(status))
      .reduce((total, [, count]) => total + count, 0);
    const plan = await prisma.$queryRaw`
      EXPLAIN ANALYZE SELECT id, event_time, speed_kph FROM telemetry_readings
      WHERE vehicle_id = ${vehicle.id}::uuid ORDER BY event_time DESC LIMIT 50
    `;
    const result = {
      generatedAt: new Date().toISOString(),
      machine: { platform: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length, memoryGiB: Number((os.totalmem() / 1024 ** 3).toFixed(1)) },
      node: process.version,
      postgres: database[0].version,
      workload: {
        directEvents: targetEvents, batchEvents: targetEvents, batchSize: groupSize, concurrency, vehicleCount: 1,
        workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 8),
        apiRateLimitPerMinute: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 1200),
      },
      runtime: {
        appDeployment: process.env.BENCH_DEPLOYMENT || 'local Docker Compose',
        database: 'containerized PostgreSQL',
        queue: process.env.REDIS_URL ? 'containerized Redis + BullMQ worker' : 'synchronous (Redis disabled)',
        streaming: process.env.KAFKA_BROKERS ? 'containerized Redpanda/Kafka' : 'disabled',
      },
      requests: requestCounts,
      ingestionMode: process.env.REDIS_URL ? 'asynchronous (Redis/BullMQ)' : 'synchronous',
      metrics: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, {
        samples: values.length,
        meanMs: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : 0,
        p50Ms: Number(quantile(values, 0.50).toFixed(2)), p95Ms: Number(quantile(values, 0.95).toFixed(2)), p99Ms: Number(quantile(values, 0.99).toFixed(2)),
      }])),
      wallClock: { directMs: Number(directDurationMs.toFixed(2)), batchMs: Number(batchDurationMs.toFixed(2)) },
      batchEventsPerSecond: Number((targetEvents / (batchDurationMs / 1000)).toFixed(2)),
      directEventsPerSecond: Number((targetEvents / (directDurationMs / 1000)).toFixed(2)),
      telemetryRowsPersisted: await prisma.telemetryReading.count({ where: { vehicleId: vehicle.id } }),
      outboxRowsPersisted: await prisma.outboxEvent.count({ where: { vehicleId: vehicle.id } }),
      outboxRowsPublished: await prisma.outboxEvent.count({ where: { vehicleId: vehicle.id, publishedAt: { not: null } } }),
      kafkaInboxRows: await prisma.kafkaInbox.groupBy({ by: ['consumerGroup'], where: { eventKey: { contains: vehicle.id } }, _count: { _all: true } })
        .then((rows) => Object.fromEntries(rows.map((row) => [row.consumerGroup, row._count._all]))),
      ingestionStatusCounts,
      errorRate: requestCounts.total ? Number((requestCounts.failed / requestCounts.total).toFixed(6)) : 0,
      rejectedEventRate: eventCount ? Number((unsuccessfulCount / eventCount).toFixed(6)) : 0,
      requestCompletionMs: {
        samples: requestCompletion.length,
        mean: requestCompletion.length ? Number((requestCompletion.reduce((a, b) => a + b, 0) / requestCompletion.length).toFixed(2)) : null,
        p95: requestCompletion.length ? Number(quantile(requestCompletion, 0.95).toFixed(2)) : null,
      },
      queryPlan: plan.map((line) => Object.values(line)[0]),
    };
    const runLabel = (process.env.BENCH_LABEL || 'run').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const runTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = process.env.BENCH_REPORT_PATH || path.join(process.cwd(), 'docs', 'benchmarks', `benchmark-${targetEvents}-${new Date().toISOString().slice(0, 10)}-${runLabel}-${runTimestamp}.json`);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ reportPath, result }, null, 2)}\n`);
  } finally {
    try {
      const cleanupDeadline = Date.now() + 120_000;
      let pending = await prisma.ingestionRequest.count({
        where: { organizationId: organization.id, status: { in: ['RECEIVED', 'PROCESSING'] } },
      });
      while (pending && Date.now() < cleanupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        pending = await prisma.ingestionRequest.count({
          where: { organizationId: organization.id, status: { in: ['RECEIVED', 'PROCESSING'] } },
        });
      }
      if (pending) {
        process.stderr.write('Benchmark fixture retained because ingestion was still processing during cleanup.\n');
        process.exitCode = 1;
      } else {
        if (vehicle) {
          await prisma.outboxEvent.deleteMany({ where: { vehicleId: vehicle.id } });
          await prisma.derivedEvent.deleteMany({ where: { vehicleId: vehicle.id } });
          await prisma.quarantineRecord.deleteMany({ where: { vehicleId: vehicle.id } });
          await prisma.vehicleState.deleteMany({ where: { vehicleId: vehicle.id } });
          await prisma.telemetryReading.deleteMany({ where: { vehicleId: vehicle.id } });
        }
        const benchRequests = await prisma.ingestionRequest.findMany({ where: { organizationId: organization.id }, select: { id: true } });
        const allRequestIds = benchRequests.map((row) => row.id);
        if (allRequestIds.length) {
          await prisma.quarantineRecord.deleteMany({ where: { requestId: { in: allRequestIds } } });
          await prisma.ingestionEvent.deleteMany({ where: { requestId: { in: allRequestIds } } });
          await prisma.ingestionRequest.deleteMany({ where: { id: { in: allRequestIds } } });
        }
        if (vehicle) await prisma.vehicle.delete({ where: { id: vehicle.id } });
        await prisma.apiClient.delete({ where: { id: client.id } });
        await prisma.organization.delete({ where: { id: organization.id } });
      }
    } catch (error) {
      process.stderr.write(`Benchmark cleanup failed: ${error.message}\n`);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }
}

run().catch(async (error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  await prisma.$disconnect();
  process.exitCode = 1;
});
