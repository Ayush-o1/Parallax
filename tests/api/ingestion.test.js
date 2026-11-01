'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const supertest = require('supertest');
const app = require('../../src/app');
const prisma = require('../../src/db/prisma');

const requestIds = new Set();
const vehicleIds = new Set();
const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function vin() {
  const bytes = crypto.randomBytes(17);
  return [...bytes].map((byte) => VIN_CHARS[byte % VIN_CHARS.length]).join('');
}
function alphaPayload(vehicleVin, eventId, timestamp = new Date().toISOString(), odometer = 100) {
  return {
    vin: vehicleVin, speed: 30, speed_unit: 'mph', odometer, latitude: 12.9, longitude: 77.5,
    fuel_level: 70, engine_on: true, event_id: eventId, timestamp,
  };
}

describe('telemetry ingestion', () => {
  let demo;
  before(async () => { demo = await prisma.organization.findUnique({ where: { slug: 'demo' } }); });

  after(async () => {
    const ids = [...vehicleIds];
    if (ids.length) {
      await prisma.outboxEvent.deleteMany({ where: { vehicleId: { in: ids } } });
      await prisma.derivedEvent.deleteMany({ where: { vehicleId: { in: ids } } });
      await prisma.quarantineRecord.deleteMany({ where: { vehicleId: { in: ids } } });
      await prisma.vehicleState.deleteMany({ where: { vehicleId: { in: ids } } });
      await prisma.telemetryReading.deleteMany({ where: { vehicleId: { in: ids } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: ids } } });
    }
    if (requestIds.size) {
      await prisma.quarantineRecord.deleteMany({ where: { requestId: { in: [...requestIds] } } });
      await prisma.ingestionEvent.deleteMany({ where: { requestId: { in: [...requestIds] } } });
      await prisma.ingestionRequest.deleteMany({ where: { id: { in: [...requestIds] } } });
    }
  });

  async function register(vehicleVin) {
    const row = await prisma.vehicle.create({ data: { organizationId: demo.id, vin: vehicleVin, source: 'OEM_ALPHA' } });
    vehicleIds.add(row.id);
    return row;
  }

  async function post(payload, source = 'OEM_ALPHA') {
    const response = await supertest(app).post(`/api/v1/ingest/${source}`).send(payload);
    if (response.body.data?.requestId) requestIds.add(response.body.data.requestId);
    return response;
  }

  it('stores exact malformed request bytes and creates request-level quarantine', async () => {
    const raw = '{"vin": broken\n';
    const response = await supertest(app).post('/api/v1/ingest/OEM_ALPHA')
      .set('content-type', 'application/json').send(raw);
    assert.equal(response.status, 400);
    const id = response.body.data.requestId;
    requestIds.add(id);
    const stored = await prisma.ingestionRequest.findUnique({ where: { id } });
    assert.equal(stored.status, 'MALFORMED');
    assert.deepEqual(Buffer.from(stored.rawBody), Buffer.from(raw));
    assert.equal(await prisma.quarantineRecord.count({ where: { requestId: id, eventId: null } }), 1);
  });

  it('preserves compressed wire bytes before decoding a valid telemetry payload', async () => {
    const vehicleVin = vin();
    await register(vehicleVin);
    const original = Buffer.from(JSON.stringify(alphaPayload(vehicleVin, `gzip-${crypto.randomUUID()}`)));
    const compressed = zlib.gzipSync(original);
    const response = await supertest(app).post('/api/v1/ingest/OEM_ALPHA')
      .set('content-type', 'application/octet-stream').set('content-encoding', 'gzip').send(compressed);
    requestIds.add(response.body.data.requestId);
    const stored = await prisma.ingestionRequest.findUnique({ where: { id: response.body.data.requestId } });
    assert.equal(response.status, 200, `${stored.errorCode}: ${stored.errorDetail}`);
    assert.deepEqual(Buffer.from(stored.rawBody), compressed);
    assert.equal(response.body.data.eventResults[0].status, 'ACCEPTED');
  });

  it('processes batch members independently and persists invalid siblings to quarantine', async () => {
    const vehicleVin = vin();
    await register(vehicleVin);
    const body = [
      alphaPayload(vehicleVin, `valid-${crypto.randomUUID()}`),
      { ...alphaPayload(vehicleVin, `invalid-${crypto.randomUUID()}`), fuel_level: 101 },
    ];
    const response = await post(body);
    assert.equal(response.status, 207);
    assert.deepEqual(response.body.data.eventResults.map((event) => event.status), ['ACCEPTED', 'QUARANTINED']);
    const events = await prisma.ingestionEvent.findMany({ where: { requestId: response.body.data.requestId }, orderBy: { ordinal: 'asc' } });
    assert.deepEqual(events.map((event) => event.status), ['ACCEPTED', 'QUARANTINED']);
    assert.equal(await prisma.telemetryReading.count({ where: { ingestionEventId: events[0].id } }), 1);
    assert.equal(await prisma.quarantineRecord.count({ where: { eventId: events[1].id } }), 1);
  });

  it('preserves duplicate receipt attempts without duplicate readings or state changes', async () => {
    const vehicleVin = vin();
    const vehicle = await register(vehicleVin);
    const eventId = `same-${crypto.randomUUID()}`;
    const payload = alphaPayload(vehicleVin, eventId);
    const first = await post(payload);
    const second = await post(payload);
    assert.equal(first.body.data.eventResults[0].status, 'ACCEPTED');
    assert.equal(second.body.data.eventResults[0].status, 'DUPLICATE');
    assert.equal(await prisma.telemetryReading.count({ where: { vehicleId: vehicle.id } }), 1);
    assert.equal(await prisma.ingestionEvent.count({ where: { requestId: { in: [first.body.data.requestId, second.body.data.requestId] } } }), 2);
  });

  it('stores late history without regression and quarantines suspicious newer odometer values', async () => {
    const vehicleVin = vin();
    const vehicle = await register(vehicleVin);
    const base = Date.now() - 10_000;
    await post(alphaPayload(vehicleVin, `new-${crypto.randomUUID()}`, new Date(base + 2_000).toISOString(), 100));
    const late = await post(alphaPayload(vehicleVin, `late-${crypto.randomUUID()}`, new Date(base + 1_000).toISOString(), 150));
    assert.equal(late.body.data.eventResults[0].status, 'ACCEPTED');
    const suspicious = await post(alphaPayload(vehicleVin, `suspicious-${crypto.randomUUID()}`, new Date(base + 3_000).toISOString(), 90));
    assert.equal(suspicious.body.data.eventResults[0].status, 'ACCEPTED_WITH_WARNINGS');
    const state = await prisma.vehicleState.findUnique({ where: { vehicleId: vehicle.id }, include: { latestReading: true } });
    assert.equal(Number(state.trustedOdometerKm), 100 * 1.60934);
    assert.equal(state.latestReading.odometerSuspicious, true);
    assert.equal(await prisma.telemetryReading.count({ where: { vehicleId: vehicle.id } }), 3);
  });

  it('serializes concurrent duplicate submissions using database constraints', async () => {
    const vehicleVin = vin();
    const vehicle = await register(vehicleVin);
    const payload = alphaPayload(vehicleVin, `race-${crypto.randomUUID()}`);
    const [one, two] = await Promise.all([post(payload), post(payload)]);
    assert.deepEqual([one.body.data.eventResults[0].status, two.body.data.eventResults[0].status].sort(), ['ACCEPTED', 'DUPLICATE']);
    assert.equal(await prisma.telemetryReading.count({ where: { vehicleId: vehicle.id } }), 1);
  });

  it('serves tenant-scoped state, history, event, summary and quarantine APIs from persisted data', async () => {
    const vehicleVin = vin();
    const vehicle = await register(vehicleVin);
    const accepted = await post(alphaPayload(vehicleVin, `query-${crypto.randomUUID()}`));
    const rejected = await post({ ...alphaPayload(vehicleVin, `query-bad-${crypto.randomUUID()}`), latitude: 95 });
    const [stateResponse, history, events, summary, ingestions, quarantine] = await Promise.all([
      supertest(app).get(`/api/v1/vehicles/${vehicle.id}/state`),
      supertest(app).get(`/api/v1/vehicles/${vehicle.id}/telemetry`).query({ limit: 10 }),
      supertest(app).get(`/api/v1/vehicles/${vehicle.id}/events`).query({ limit: 10 }),
      supertest(app).get('/api/v1/summary'),
      supertest(app).get('/api/v1/ingestions'),
      supertest(app).get('/api/v1/quarantine').query({ reason: 'OUT_OF_RANGE' }),
    ]);
    assert.equal(accepted.body.data.eventResults[0].status, 'ACCEPTED');
    assert.equal(rejected.body.data.eventResults[0].status, 'QUARANTINED');
    assert.equal(stateResponse.status, 200);
    assert.equal(stateResponse.body.data.latestReading.vehicleId, vehicle.id);
    assert.equal(history.body.data.length, 1);
    assert.equal(events.status, 200);
    assert.equal(summary.status, 200);
    assert.ok(summary.body.data.vehicles.total >= 1);
    assert.ok(ingestions.body.data.length >= 2);
    assert.equal(quarantine.status, 200);
    assert.ok(quarantine.body.data.some((item) => item.rawRequestBase64));
  });

  it('detects trip end and excessive idling only after their event-time durations', async () => {
    const vehicleVin = vin();
    const vehicle = await register(vehicleVin);
    const start = Date.now() - 250_000;
    const readings = [
      alphaPayload(vehicleVin, `trip-start-${crypto.randomUUID()}`, new Date(start).toISOString(), 100),
      { ...alphaPayload(vehicleVin, `idle-start-${crypto.randomUUID()}`, new Date(start + 5_000).toISOString(), 100), speed: 0 },
      { ...alphaPayload(vehicleVin, `trip-end-${crypto.randomUUID()}`, new Date(start + 130_000).toISOString(), 100), speed: 0 },
      { ...alphaPayload(vehicleVin, `idle-threshold-${crypto.randomUUID()}`, new Date(start + 190_000).toISOString(), 100), speed: 0 },
      { ...alphaPayload(vehicleVin, `idle-repeat-${crypto.randomUUID()}`, new Date(start + 200_000).toISOString(), 100), speed: 0 },
    ];
    for (const reading of readings) {
      const response = await post(reading);
      assert.equal(response.body.data.eventResults[0].status, 'ACCEPTED');
    }
    const events = await prisma.derivedEvent.findMany({ where: { vehicleId: vehicle.id } });
    assert.equal(events.filter((item) => item.eventType === 'TRIP_STARTED').length, 1);
    assert.equal(events.filter((item) => item.eventType === 'TRIP_ENDED').length, 1);
    assert.equal(events.filter((item) => item.eventType === 'EXCESSIVE_IDLING').length, 1);
  });
});
