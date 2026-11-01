'use strict';

const { after, before, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const config = require('../../src/config/env');

config.validateConfig();
assert.equal(new URL(config.databaseUrl).pathname, '/parallax_test');

const prisma = new PrismaClient();
const fixture = {
  organizationId: undefined,
  vehicleId: undefined,
  requestIds: [],
  eventIds: [],
  readingIds: [],
};

async function createRequest({ rawBody, parsedPayload = undefined, source = 'OEM_ALPHA' }) {
  const request = await prisma.ingestionRequest.create({
    data: {
      organizationId: fixture.organizationId,
      source,
      rawBody,
      ...(parsedPayload !== undefined && { parsedPayload }),
    },
  });
  fixture.requestIds.push(request.id);
  return request;
}

async function createEvent(requestId, ordinal, overrides = {}) {
  const event = await prisma.ingestionEvent.create({
    data: {
      requestId,
      ordinal,
      source: 'OEM_ALPHA',
      externalEventId: `IT-${randomUUID()}`,
      rawVin: '1HGCM82633A004352',
      payload: { fixture: true },
      eventTime: new Date('2026-10-30T10:00:00.000Z'),
      ...overrides,
    },
  });
  fixture.eventIds.push(event.id);
  return event;
}

function readingData(ingestionEventId, externalEventId, overrides = {}) {
  return {
    ingestionEventId,
    vehicleId: fixture.vehicleId,
    source: 'OEM_ALPHA',
    externalEventId,
    eventTime: new Date('2026-10-30T10:00:00.000Z'),
    receivedAt: new Date(),
    speedKph: 72.125,
    odometerKm: 32100.125,
    fuelPercent: 72.5,
    latitude: 12.9716,
    longitude: 77.5946,
    engineOn: true,
    ...overrides,
  };
}

describe('Prisma/PostgreSQL persistence integration', { concurrency: false }, () => {
  before(async () => {
    // Each run owns a fresh organization so cleanup never touches shared data.
    const organization = await prisma.organization.create({
      data: {
        slug: `it-${randomUUID()}`,
        name: 'Integration Test Organization',
      },
    });
    fixture.organizationId = organization.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: organization.id,
        vin: `1HGCM82633A${randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`,
        source: 'OEM_ALPHA',
      },
    });
    fixture.vehicleId = vehicle.id;
  });

  after(async () => {
    if (fixture.vehicleId) {
      await prisma.outboxEvent.deleteMany({ where: { vehicleId: fixture.vehicleId } });
      await prisma.derivedEvent.deleteMany({ where: { vehicleId: fixture.vehicleId } });
      await prisma.vehicleState.deleteMany({ where: { vehicleId: fixture.vehicleId } });
      await prisma.quarantineRecord.deleteMany({ where: { requestId: { in: fixture.requestIds } } });
      await prisma.telemetryReading.deleteMany({ where: { vehicleId: fixture.vehicleId } });
    }
    if (fixture.requestIds.length) {
      await prisma.ingestionEvent.deleteMany({ where: { requestId: { in: fixture.requestIds } } });
      await prisma.ingestionRequest.deleteMany({ where: { id: { in: fixture.requestIds } } });
    }
    if (fixture.vehicleId) {
      await prisma.vehicle.delete({ where: { id: fixture.vehicleId } });
    }
    if (fixture.organizationId) {
      await prisma.organization.delete({ where: { id: fixture.organizationId } });
    }
    await prisma.$disconnect();
  });

  it('stores database-generated UUIDs, exact BYTEA, JSONB, and organization ownership', async () => {
    const rawBody = Buffer.from('{ "vin":"1HGCM82633A004352", "speed":45 }');
    const request = await createRequest({
      rawBody,
      parsedPayload: { vin: '1HGCM82633A004352', speed: 45 },
    });

    assert.match(request.id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(Buffer.from(request.rawBody), rawBody);
    assert.deepEqual(request.parsedPayload, { vin: '1HGCM82633A004352', speed: 45 });
    assert.equal(request.organizationId, fixture.organizationId);
  });

  it('tracks batch outcomes independently and permits request-level quarantine without event or vehicle', async () => {
    const request = await createRequest({ rawBody: Buffer.from('{bad json') });
    const first = await createEvent(request.id, 0, { status: 'ACCEPTED' });
    const second = await createEvent(request.id, 1, { status: 'QUARANTINED' });

    const quarantine = await prisma.quarantineRecord.create({
      data: {
        requestId: request.id,
        source: 'OEM_DELTA',
        reason: 'MALFORMED_REQUEST',
        detail: 'Request body could not be parsed.',
      },
    });
    assert.equal(quarantine.eventId, null);
    assert.equal(quarantine.vehicleId, null);
    assert.equal((await prisma.ingestionEvent.findUnique({ where: { id: first.id } })).status, 'ACCEPTED');
    assert.equal((await prisma.ingestionEvent.findUnique({ where: { id: second.id } })).status, 'QUARANTINED');

    await assert.rejects(
      createEvent(request.id, 1),
      (error) => error.code === 'P2002'
    );
  });

  it('enforces unique vehicle ownership within an organization', async () => {
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: fixture.vehicleId } });
    await assert.rejects(
      prisma.vehicle.create({
        data: {
          organizationId: fixture.organizationId,
          vin: vehicle.vin,
          source: 'OEM_BETA',
        },
      }),
      (error) => error.code === 'P2002'
    );
  });

  it('guarantees concurrent telemetry idempotency and validates measurement CHECK constraints', async () => {
    const request = await createRequest({ rawBody: Buffer.from('[]'), parsedPayload: [] });
    const events = await Promise.all([
      createEvent(request.id, 0),
      createEvent(request.id, 1),
    ]);
    const externalEventId = `ALPHA-${randomUUID()}`;

    const attempts = await Promise.allSettled(events.map((event) =>
      prisma.telemetryReading.create({ data: readingData(event.id, externalEventId) })
    ));
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected' && result.reason.code === 'P2002').length, 1);

    const accepted = attempts.find((result) => result.status === 'fulfilled').value;
    fixture.readingIds.push(accepted.id);
    const invalidSpeedEvent = await createEvent(request.id, 2);
    await assert.rejects(
      prisma.telemetryReading.create({
        data: readingData(invalidSpeedEvent.id, `BAD-${randomUUID()}`, { speedKph: 401 }),
      }),
      (error) => error.message.includes('telemetry_speed_range_ck')
    );
    const invalidLatitudeEvent = await createEvent(request.id, 3);
    await assert.rejects(
      prisma.telemetryReading.create({
        data: readingData(invalidLatitudeEvent.id, `BAD-${randomUUID()}`, { latitude: 91 }),
      }),
      (error) => error.message.includes('telemetry_latitude_range_ck')
    );
  });

  it('enforces vehicle-state and derived-event uniqueness', async () => {
    const request = await createRequest({ rawBody: Buffer.from('{}'), parsedPayload: {} });
    const event = await createEvent(request.id, 0);
    const reading = await prisma.telemetryReading.create({
      data: readingData(event.id, `STATE-${randomUUID()}`),
    });
    fixture.readingIds.push(reading.id);

    await prisma.vehicleState.create({
      data: {
        vehicleId: fixture.vehicleId,
        latestReadingId: reading.id,
        lastEventTime: reading.eventTime,
        trustedOdometerKm: reading.odometerKm,
      },
    });
    await assert.rejects(
      prisma.vehicleState.create({
        data: {
          vehicleId: fixture.vehicleId,
          latestReadingId: reading.id,
          lastEventTime: reading.eventTime,
          trustedOdometerKm: reading.odometerKm,
        },
      }),
      (error) => error.code === 'P2002'
    );

    const derived = {
      vehicleId: fixture.vehicleId,
      sourceReadingId: reading.id,
      eventType: 'TRIP_START',
      severity: 'INFO',
      dedupeKey: `trip-start:${fixture.vehicleId}:OEM_ALPHA:${reading.externalEventId}`,
      occurredAt: reading.eventTime,
      explanation: 'Integration fixture.',
    };
    await prisma.derivedEvent.create({ data: derived });
    await assert.rejects(prisma.derivedEvent.create({ data: derived }), (error) => error.code === 'P2002');
  });

  it('enforces transactional outbox keys and consumer-group inbox idempotency', async () => {
    const first = await prisma.outboxEvent.create({ data: {
      organizationId: fixture.organizationId,
      vehicleId: fixture.vehicleId,
      eventType: 'TELEMETRY_NORMALIZED',
      eventKey: `telemetry:${fixture.vehicleId}:${randomUUID()}`,
      payload: { speedKph: 12.5 },
    } });
    fixture.outboxIds = fixture.outboxIds || [];
    fixture.outboxIds.push(first.id);
    const duplicate = {
      organizationId: fixture.organizationId,
      vehicleId: fixture.vehicleId,
      eventType: 'TELEMETRY_NORMALIZED',
      eventKey: first.eventKey,
      payload: { speedKph: 12.5 },
    };
    await assert.rejects(prisma.outboxEvent.create({ data: duplicate }), (error) => error.code === 'P2002');
    const inbox = {
      consumerGroup: 'integration-consumer',
      eventKey: first.eventKey,
      topic: 'telemetry.normalized.v1',
      partition: 0,
      offset: BigInt(Date.now()),
    };
    await prisma.kafkaInbox.create({ data: inbox });
    await assert.rejects(prisma.kafkaInbox.create({ data: inbox }), (error) => error.code === 'P2002');
  });

  it('rolls back a failed transaction without leaving partial request data', async () => {
    const before = await prisma.ingestionRequest.count({ where: { organizationId: fixture.organizationId } });
    await assert.rejects(prisma.$transaction(async (tx) => {
      await tx.ingestionRequest.create({
        data: {
          organizationId: fixture.organizationId,
          source: 'OEM_ALPHA',
          rawBody: Buffer.from('rollback fixture'),
        },
      });
      throw new Error('force rollback');
    }), /force rollback/);

    const afterCount = await prisma.ingestionRequest.count({ where: { organizationId: fixture.organizationId } });
    assert.equal(afterCount, before);
  });

  it('recovers a raw request committed before parsing or event extraction', async () => {
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: fixture.vehicleId } });
    const payload = {
      vin: vehicle.vin, speed: 20, speed_unit: 'mph', odometer: 50_000,
      latitude: 12.9, longitude: 77.5, fuel_level: 60, engine_on: true,
      event_id: `RECOVER-${randomUUID()}`, timestamp: new Date().toISOString(),
    };
    const request = await createRequest({ rawBody: Buffer.from(JSON.stringify(payload)) });
    assert.equal(request.parsedAt, null);
    assert.ok(await prisma.vehicle.findFirst({ where: { organizationId: request.organizationId, vin: vehicle.vin } }));

    const ingestionService = require('../../src/services/ingestion.service');
    const outcome = await ingestionService.processRequest(request.id);
    const quarantine = await prisma.quarantineRecord.findFirst({ where: { requestId: request.id } });
    assert.equal(outcome.status, 'COMPLETED', JSON.stringify({ outcome, quarantine }));
    assert.equal(outcome.eventResults[0].status, 'ACCEPTED');
    assert.ok(await prisma.ingestionEvent.findFirst({ where: { requestId: request.id } }));
  });

  it('re-enqueues durable requests left received or processing when a worker starts', async () => {
    const received = await createRequest({ rawBody: Buffer.from('received before queue delivery') });
    const processing = await createRequest({ rawBody: Buffer.from('worker stopped during processing') });
    await prisma.ingestionRequest.update({ where: { id: processing.id }, data: { status: 'PROCESSING' } });

    const scheduled = [];
    const queue = {
      getJob: async () => null,
      add: async (name, data, options) => { scheduled.push({ name, data, options }); },
    };
    const { recoverPending } = require('../../src/workers/ingestionWorker');
    const recovered = await recoverPending(queue);

    const scheduledIds = new Set(scheduled.map((job) => job.data.requestId));
    assert.ok(recovered >= 2);
    assert.ok(scheduledIds.has(received.id));
    assert.ok(scheduledIds.has(processing.id));
    assert.equal(scheduled.find((job) => job.data.requestId === received.id).options.jobId, `ingestion-${received.id}`);
  });
});
