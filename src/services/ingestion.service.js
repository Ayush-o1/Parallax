'use strict';

const config = require('../config/env');
const zlib = require('node:zlib');
const prisma = require('../db/prisma');
const adapters = require('../adapters');
const ingestionRepository = require('../repositories/ingestion.repository');
const eventDetection = require('./eventDetection.service');
const realtimeHub = require('../realtime/hub');
const { ingestionEvents } = require('../middleware/requestMetrics');

function extractEvents(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.events)) return payload.events;
  return [payload];
}

function eventError(code, detail) {
  const error = new Error(detail);
  error.code = code;
  return error;
}

async function quarantine(tx, { requestId, eventId, source, rawVin, vehicleId = null, reason, detail }) {
  await tx.quarantineRecord.create({ data: { requestId, eventId, source, rawVin, vehicleId, reason, detail } });
  await tx.ingestionEvent.update({ where: { id: eventId }, data: { status: 'QUARANTINED', processedAt: new Date() } });
}

async function processOne(request, event) {
  const adapter = adapters.forSource(event.source);
  if (!adapter) {
    await prisma.$transaction((tx) => quarantine(tx, {
      requestId: request.id, eventId: event.id, source: event.source,
      rawVin: event.rawVin, reason: 'UNKNOWN_SOURCE', detail: `Unsupported source: ${event.source}`,
    }));
    return 'QUARANTINED';
  }

  let normalized;
  try {
    normalized = adapter.normalize(event.payload);
  } catch (error) {
    await prisma.$transaction((tx) => quarantine(tx, {
      requestId: request.id, eventId: event.id, source: event.source,
      rawVin: event.rawVin || (typeof event.payload?.vin === 'string' ? event.payload.vin : null),
      reason: error.code || 'INVALID_PAYLOAD', detail: error.message,
    }));
    return 'QUARANTINED';
  }

  const receivedAt = request.receivedAt;
  const ageSeconds = (receivedAt.getTime() - normalized.eventTime.getTime()) / 1000;
  if (ageSeconds > config.maxEventAgePastSeconds || ageSeconds < -config.maxEventAgeFutureSeconds) {
    await prisma.$transaction((tx) => quarantine(tx, {
      requestId: request.id, eventId: event.id, source: event.source, rawVin: normalized.vin,
      reason: 'TIMESTAMP_OUT_OF_RANGE', detail: 'Event time falls outside the configured acceptance window.',
    }));
    return 'QUARANTINED';
  }

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      // The vehicle-row lock serializes anomaly classification for a VIN. The
      // UPSERT below remains the state correctness boundary under concurrency.
      const vehicles = await tx.$queryRaw`SELECT id, source FROM vehicles WHERE organization_id = ${request.organizationId}::uuid AND vin = ${normalized.vin} FOR UPDATE`;
      const vehicle = vehicles[0];
      if (!vehicle) {
        await quarantine(tx, {
          requestId: request.id, eventId: event.id, source: event.source, rawVin: normalized.vin,
          reason: 'UNKNOWN_VIN', detail: 'VIN is not registered to this organization.',
        });
        return 'QUARANTINED';
      }
      if (vehicle.source !== event.source) {
        await quarantine(tx, {
          requestId: request.id, eventId: event.id, source: event.source, rawVin: normalized.vin,
          vehicleId: vehicle.id, reason: 'SOURCE_MISMATCH', detail: 'Telemetry source does not match the registered vehicle source.',
        });
        return 'QUARANTINED';
      }

      const previous = await tx.vehicleState.findUnique({
        where: { vehicleId: vehicle.id },
        include: { latestReading: true },
      });
      const isNewer = !previous || normalized.eventTime > previous.lastEventTime;
      const priorOdometer = previous?.trustedOdometerKm;
      const odometerSuspicious = Boolean(isNewer && normalized.odometerKm !== null && priorOdometer !== null
        && normalized.odometerKm < Number(priorOdometer));

      const reading = await tx.telemetryReading.create({ data: {
        ingestionEventId: event.id,
        vehicleId: vehicle.id,
        source: normalized.source,
        externalEventId: normalized.externalEventId,
        eventTime: normalized.eventTime,
        receivedAt,
        speedKph: String(normalized.speedKph),
        odometerKm: normalized.odometerKm === null ? null : String(normalized.odometerKm),
        odometerSuspicious,
        fuelPercent: String(normalized.fuelPercent),
        latitude: String(normalized.latitude),
        longitude: String(normalized.longitude),
        engineOn: normalized.engineOn,
        accelMss: normalized.accelMss === null ? null : String(normalized.accelMss),
      } });

      // PostgreSQL resolves the unique vehicle_id conflict under a row lock and
      // evaluates the event-time predicate against the current committed row.
      // Two concurrent writers cannot both replace state from the same stale
      // application read; older events simply affect zero rows.
      await tx.$executeRaw`
        INSERT INTO vehicle_states (id, vehicle_id, latest_reading_id, last_event_time, trusted_odometer_km, updated_at)
        VALUES (gen_random_uuid(), ${vehicle.id}::uuid, ${reading.id}::uuid, ${normalized.eventTime},
          ${odometerSuspicious || normalized.odometerKm === null ? null : String(normalized.odometerKm)}::decimal,
          CURRENT_TIMESTAMP)
        ON CONFLICT (vehicle_id) DO UPDATE SET
          latest_reading_id = EXCLUDED.latest_reading_id,
          last_event_time = EXCLUDED.last_event_time,
          trusted_odometer_km = CASE
            WHEN ${odometerSuspicious} OR ${normalized.odometerKm === null} THEN vehicle_states.trusted_odometer_km
            ELSE EXCLUDED.trusted_odometer_km
          END,
          updated_at = CURRENT_TIMESTAMP
        WHERE vehicle_states.last_event_time < EXCLUDED.last_event_time
      `;

      if (odometerSuspicious) {
        await tx.quarantineRecord.create({ data: {
          requestId: request.id, eventId: event.id, vehicleId: vehicle.id,
          source: event.source, rawVin: normalized.vin, reason: 'ODOMETER_REGRESSION',
          detail: 'Newer event reports an odometer below the last trusted event-time reading.',
        } });
      }
      await tx.ingestionEvent.update({ where: { id: event.id }, data: {
        status: odometerSuspicious ? 'ACCEPTED_WITH_WARNINGS' : 'ACCEPTED', processedAt: new Date(),
        eventTime: normalized.eventTime, externalEventId: normalized.externalEventId, rawVin: normalized.vin,
      } });
      const operationalEvents = await eventDetection.detect(tx, { vehicleId: vehicle.id, reading, previous, isNewer, odometerSuspicious });
      await tx.outboxEvent.createMany({
        data: [
          {
            organizationId: request.organizationId,
            vehicleId: vehicle.id,
            eventType: 'TELEMETRY_NORMALIZED',
            eventKey: `telemetry:${vehicle.id}:${normalized.source}:${normalized.externalEventId}`,
            payload: {
              schemaVersion: 1,
              organizationId: request.organizationId,
              vehicleId: vehicle.id,
              source: normalized.source,
              externalEventId: normalized.externalEventId,
              eventTime: normalized.eventTime.toISOString(),
              receivedAt: receivedAt.toISOString(),
              measurements: {
                speedKph: normalized.speedKph,
                odometerKm: normalized.odometerKm,
                odometerSuspicious,
                fuelPercent: normalized.fuelPercent,
                latitude: normalized.latitude,
                longitude: normalized.longitude,
                engineOn: normalized.engineOn,
                accelMss: normalized.accelMss,
              },
            },
          },
          ...operationalEvents.map((event) => ({
            organizationId: request.organizationId,
            vehicleId: vehicle.id,
            eventType: event.type,
            eventKey: `operational:${eventDetection.key(event.type, vehicle.id, normalized.source, event.trigger)}`,
            payload: {
              schemaVersion: 1,
              organizationId: request.organizationId,
              vehicleId: vehicle.id,
              eventType: event.type,
              severity: event.severity,
              source: normalized.source,
              triggerEventId: event.trigger,
              occurredAt: normalized.eventTime.toISOString(),
              explanation: event.explanation,
            },
          })),
        ],
        skipDuplicates: true,
      });
      return {
        status: odometerSuspicious ? 'ACCEPTED_WITH_WARNINGS' : 'ACCEPTED',
        vehicleId: vehicle.id,
        stateAdvanced: isNewer,
        readingId: reading.id,
        eventTime: reading.eventTime,
        operationalEvents,
      };
    });
    const status = typeof outcome === 'string' ? outcome : outcome.status;
    realtimeHub.publish(request.organizationId, 'ingestion.event.processed', {
      ingestionRequestId: request.id, ingestionEventId: event.id, status,
    });
    if (typeof outcome !== 'string') {
      realtimeHub.publish(request.organizationId, 'telemetry.accepted', {
        vehicleId: outcome.vehicleId, telemetryReadingId: outcome.readingId, eventTime: outcome.eventTime,
      });
      if (outcome.stateAdvanced) realtimeHub.publish(request.organizationId, 'vehicle.state.updated', {
        vehicleId: outcome.vehicleId, telemetryReadingId: outcome.readingId, eventTime: outcome.eventTime,
      });
      for (const operationalEvent of outcome.operationalEvents) {
        realtimeHub.publish(request.organizationId, 'operational.event.created', {
          vehicleId: outcome.vehicleId, eventType: operationalEvent.type, occurredAt: outcome.eventTime,
        });
      }
    }
    return status;
  } catch (error) {
    if (error.code === 'P2002') {
      // The failed insert transaction rolled back; preserve this receipt as a
      // duplicate outcome in a small, separate transaction.
      await prisma.ingestionEvent.update({ where: { id: event.id }, data: { status: 'DUPLICATE', processedAt: new Date() } });
      realtimeHub.publish(request.organizationId, 'ingestion.event.processed', {
        ingestionRequestId: request.id, ingestionEventId: event.id, status: 'DUPLICATE',
      });
      return 'DUPLICATE';
    }
    throw error;
  }
}

async function prepareRequest(request) {
  if (request.parsedAt) return { events: await prisma.ingestionEvent.findMany({ where: { requestId: request.id, status: 'PENDING' }, orderBy: { ordinal: 'asc' } }) };
  let payload;
  let parseBody = Buffer.from(request.rawBody);
  try {
    const encoding = request.contentEncoding;
    if (encoding && encoding !== 'identity') {
      if (encoding === 'gzip') parseBody = zlib.gunzipSync(parseBody, { maxOutputLength: config.maxPayloadBytes });
      else if (encoding === 'deflate') parseBody = zlib.inflateSync(parseBody, { maxOutputLength: config.maxPayloadBytes });
      else if (encoding === 'br') parseBody = zlib.brotliDecompressSync(parseBody, { maxOutputLength: config.maxPayloadBytes });
      else throw Object.assign(new Error(`Unsupported Content-Encoding: ${encoding}`), { code: 'UNSUPPORTED_CONTENT_ENCODING' });
    }
  } catch (error) {
    await ingestionRepository.markMalformed(request.id, request.source, error.code || 'INVALID_COMPRESSED_BODY', 'Request content could not be decoded.');
    return { malformed: true, requestId: request.id, status: 'MALFORMED', eventResults: [] };
  }
  try {
    payload = JSON.parse(parseBody.toString('utf8'));
  } catch {
    await ingestionRepository.markMalformed(request.id, request.source, 'MALFORMED_JSON', 'Request body is not valid JSON.');
    return { malformed: true, requestId: request.id, status: 'MALFORMED', eventResults: [] };
  }

  const items = extractEvents(payload);
  if (items.length === 0 || items.length > 500) {
    await ingestionRepository.markMalformed(request.id, request.source, 'INVALID_BATCH_SIZE', 'Payload must contain between 1 and 500 events.');
    return { malformed: true, requestId: request.id, status: 'MALFORMED', eventResults: [] };
  }
  const events = await ingestionRepository.createEvents(request.id, request.source, items, payload);
  return { events };
}

async function ingest({ organizationId, source, rawBody, contentEncoding }) {
  const request = await ingestionRepository.persistRequest({ organizationId, source, rawBody, contentEncoding });
  const prepared = await prepareRequest(request);
  if (prepared.malformed) return prepared;
  if (config.redisUrl) {
    const { enqueueIngestion } = require('../queues/ingestionQueue');
    await enqueueIngestion(request.id);
    return { requestId: request.id, status: 'PROCESSING', eventResults: prepared.events.map((event) => ({ ingestionEventId: event.id, status: 'PENDING' })) };
  }
  // Reload after prepareRequest committed parsedAt/events; the initial
  // request snapshot is intentionally stale and would otherwise re-extract
  // the same ordinals.
  return processRequest(request.id);
}

async function processRequest(requestId, requestSnapshot = undefined) {
  const request = requestSnapshot || await prisma.ingestionRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error(`Ingestion request ${requestId} was not found.`);
  const prepared = await prepareRequest(request);
  if (prepared.malformed) return prepared;
  const events = prepared.events;
  const eventResults = [];
  // Deliberately sequential within the HTTP request to bound DB pressure; every
  // item owns its own transaction, so an item failure does not roll back peers.
  for (const event of events) {
    const status = await processOne(request, event);
    ingestionEvents.inc({ status });
    eventResults.push({ ingestionEventId: event.id, status });
  }
  const finalized = await ingestionRepository.finalizeRequest(request.id);
  return { requestId: request.id, status: finalized.status, eventResults };
}

module.exports = { extractEvents, ingest, prepareRequest, processRequest };
