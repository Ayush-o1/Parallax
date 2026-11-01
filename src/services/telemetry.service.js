'use strict';

const prisma = require('../db/prisma');
const AppError = require('../utils/AppError');
const config = require('../config/env');
const { get } = require('./vehicle.service');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseTime(value, name) {
  if (value === undefined) return undefined;
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) throw new AppError(400, 'INVALID_TIME', `${name} must be a valid timestamp.`);
  return time;
}

function parseLimit(value) {
  const limit = value === undefined ? 50 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100.');
  return limit;
}

function parseCursor(value) {
  if (value !== undefined && !UUID.test(value)) throw new AppError(400, 'INVALID_CURSOR', 'cursor must be a UUID.');
  return value;
}

async function telemetry(organizationId, vehicleId, query) {
  const vehicle = await get(organizationId, vehicleId);
  const limit = parseLimit(query.limit);
  parseCursor(query.cursor);
  const from = parseTime(query.from, 'from');
  const to = parseTime(query.to, 'to');
  if (from && to && from > to) throw new AppError(400, 'INVALID_TIME_RANGE', 'from must not be later than to.');

  const rows = await prisma.telemetryReading.findMany({
    where: {
      vehicleId: vehicle.id,
      ...(from || to ? { eventTime: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
    },
    orderBy: [{ eventTime: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, page: { limit, hasMore, nextCursor: hasMore ? rows.at(-1).id : null } };
}

async function state(organizationId, vehicleId) {
  const vehicle = await get(organizationId, vehicleId);
  const value = await prisma.vehicleState.findUnique({
    where: { vehicleId: vehicle.id },
    include: { latestReading: true },
  });
  return value;
}

async function events(organizationId, vehicleId, query) {
  const vehicle = await get(organizationId, vehicleId);
  const limit = parseLimit(query.limit);
  parseCursor(query.cursor);
  const rows = await prisma.derivedEvent.findMany({
    where: { vehicleId: vehicle.id },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, page: { limit, hasMore, nextCursor: hasMore ? rows.at(-1).id : null } };
}

async function recentReadings(organizationId, query) {
  const limit = parseLimit(query.limit === undefined ? 10 : query.limit);
  parseCursor(query.cursor);
  const rows = await prisma.telemetryReading.findMany({
    where: { vehicle: { organizationId } },
    include: { vehicle: { select: { id: true, vin: true, source: true } } },
    orderBy: [{ eventTime: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, page: { limit, hasMore, nextCursor: hasMore ? rows.at(-1).id : null } };
}

async function recentEvents(organizationId, query) {
  const limit = parseLimit(query.limit === undefined ? 8 : query.limit);
  parseCursor(query.cursor);
  const rows = await prisma.derivedEvent.findMany({
    where: { vehicle: { organizationId } },
    include: { vehicle: { select: { id: true, vin: true, source: true } } },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return { items: rows, page: { limit, hasMore, nextCursor: hasMore ? rows.at(-1).id : null } };
}

async function summary(organizationId) {
  const [organization, vehicles, states, requestStatuses, eventStatuses, quarantineCount, sources] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, slug: true, isDemo: true } }),
    prisma.vehicle.count({ where: { organizationId } }),
    prisma.vehicleState.findMany({ where: { vehicle: { organizationId } }, select: { updatedAt: true, vehicle: { select: { source: true } } } }),
    prisma.ingestionRequest.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } }),
    prisma.ingestionEvent.groupBy({ by: ['status'], where: { request: { organizationId } }, _count: { _all: true } }),
    prisma.quarantineRecord.count({ where: { request: { organizationId } } }),
    prisma.vehicle.groupBy({ by: ['source'], where: { organizationId }, _count: { _all: true } }),
  ]);
  const now = Date.now();
  const active = states.filter((stateRow) => {
    const interval = config.oemReportingIntervals[stateRow.vehicle.source]
      ? config.staleThresholdFor(stateRow.vehicle.source) : config.staleVehicleFallbackSeconds;
    return now - stateRow.updatedAt.getTime() <= interval * 1000;
  }).length;
  const counts = (rows) => Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  return {
    organization: organization ? { name: organization.name, slug: organization.slug, isDemo: organization.isDemo } : null,
    vehicles: { total: vehicles, active, stale: Math.max(0, vehicles - active) },
    ingestionRequests: counts(requestStatuses), ingestionEvents: counts(eventStatuses),
    quarantined: quarantineCount,
    vehiclesBySource: Object.fromEntries(sources.map((row) => [row.source, row._count._all])),
  };
}

async function history(organizationId, query) {
  const limit = parseLimit(query.limit);
  parseCursor(query.cursor);
  const statuses = ['RECEIVED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'MALFORMED'];
  if (query.status && !statuses.includes(query.status)) throw new AppError(400, 'INVALID_STATUS', 'status is not a valid ingestion request status.');
  const rows = await prisma.ingestionRequest.findMany({
    where: { organizationId, ...(query.status && { status: query.status }) },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    select: { id: true, source: true, status: true, errorCode: true, errorDetail: true, receivedAt: true, completedAt: true, _count: { select: { events: true, quarantineRecords: true } } },
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  const eventOutcomes = rows.length ? await prisma.ingestionEvent.groupBy({
    by: ['requestId', 'status'],
    where: { requestId: { in: rows.map((row) => row.id) } },
    _count: { _all: true },
  }) : [];
  const outcomesByRequest = new Map();
  for (const outcome of eventOutcomes) {
    const requestOutcomes = outcomesByRequest.get(outcome.requestId) || {};
    requestOutcomes[outcome.status] = outcome._count._all;
    outcomesByRequest.set(outcome.requestId, requestOutcomes);
  }
  const items = rows.map((row) => ({ ...row, outcomes: outcomesByRequest.get(row.id) || {} }));
  return { items, page: { limit, hasMore, nextCursor: hasMore ? rows.at(-1).id : null } };
}

async function ingestionDetail(organizationId, requestId) {
  if (!UUID.test(requestId)) throw new AppError(400, 'INVALID_REQUEST_ID', 'requestId must be a UUID.');
  const row = await prisma.ingestionRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      events: { orderBy: { ordinal: 'asc' }, include: { quarantineRecords: true, telemetryReading: true } },
      quarantineRecords: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!row) throw new AppError(404, 'INGESTION_REQUEST_NOT_FOUND', 'Ingestion request not found.');
  const raw = Buffer.from(row.rawBody);
  return { ...row, rawBody: undefined, rawRequestBody: raw.toString('utf8'), rawRequestBase64: raw.toString('base64') };
}

async function quarantines(organizationId, query) {
  const limit = parseLimit(query.limit);
  parseCursor(query.cursor);
  const where = { request: { organizationId }, ...(query.reason && { reason: { contains: String(query.reason), mode: 'insensitive' } }) };
  const rows = await prisma.quarantineRecord.findMany({
    where, include: { event: { select: { payload: true } }, request: { select: { source: true, receivedAt: true, rawBody: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
    ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
  });
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return {
    items: rows.map(({ request: receipt, ...row }) => ({
      ...row,
      request: { source: receipt.source, receivedAt: receipt.receivedAt },
      rawRequestBody: Buffer.from(receipt.rawBody).toString('utf8'),
      rawRequestBase64: Buffer.from(receipt.rawBody).toString('base64'),
    })),
    page: { limit, hasMore, nextCursor: hasMore ? rows.at(-1).id : null },
  };
}

module.exports = { events, history, ingestionDetail, quarantines, recentEvents, recentReadings, state, summary, telemetry };
