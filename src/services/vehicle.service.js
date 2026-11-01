'use strict';

const vehicleRepository = require('../repositories/vehicle.repository');
const AppError = require('../utils/AppError');
const config = require('../config/env');

const SOURCES = new Set(['OEM_ALPHA', 'OEM_BETA', 'OEM_GAMMA']);
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateSource(source) {
  if (typeof source !== 'string' || !SOURCES.has(source)) {
    throw new AppError(400, 'INVALID_SOURCE', 'source must be OEM_ALPHA, OEM_BETA, or OEM_GAMMA.');
  }
}

function normalizeVin(value) {
  if (typeof value !== 'string') {
    throw new AppError(400, 'INVALID_VIN', 'vin must be a 17-character string.');
  }
  const vin = value.trim().toUpperCase();
  if (!VIN_PATTERN.test(vin)) {
    throw new AppError(400, 'INVALID_VIN', 'vin must be 17 valid VIN characters.');
  }
  return vin;
}

function validateId(id) {
  if (!UUID_PATTERN.test(id)) {
    throw new AppError(400, 'INVALID_VEHICLE_ID', 'vehicleId must be a UUID.');
  }
}

async function register(organizationId, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  const vin = normalizeVin(input.vin);
  validateSource(input.source);
  return vehicleRepository.create(organizationId, {
    vin,
    source: input.source,
  });
}

function parseListQuery(query) {
  const rawLimit = query.limit === undefined ? '25' : query.limit;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError(400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100.');
  }

  const search = query.search === undefined ? undefined : String(query.search).trim();
  if (search && search.length > 32) {
    throw new AppError(400, 'INVALID_SEARCH', 'search must be 32 characters or fewer.');
  }
  const source = query.source === undefined ? undefined : String(query.source);
  if (source) validateSource(source);
  const status = query.status === undefined ? undefined : String(query.status).toUpperCase();
  if (status && !['ACTIVE', 'STALE', 'OFFLINE'].includes(status)) {
    throw new AppError(400, 'INVALID_STATUS', 'status must be ACTIVE, STALE, or OFFLINE.');
  }

  let cursor;
  if (query.cursor !== undefined) {
    cursor = String(query.cursor);
    validateId(cursor);
  }
  return { limit, cursor, search: search || undefined, source, status };
}

function statusFilter(status, now = new Date()) {
  if (!status) return undefined;
  if (status === 'OFFLINE') return [{ state: { is: null } }];
  const clauses = Object.entries(config.oemReportingIntervals).map(([source, interval]) => ({
    source,
    state: { is: { updatedAt: status === 'ACTIVE'
      ? { gte: new Date(now.getTime() - interval * config.staleVehicleFactor * 1000) }
      : { lt: new Date(now.getTime() - interval * config.staleVehicleFactor * 1000) } } },
  }));
  const knownSources = Object.keys(config.oemReportingIntervals);
  clauses.push({
    source: { notIn: knownSources },
    state: { is: { updatedAt: status === 'ACTIVE'
      ? { gte: new Date(now.getTime() - config.staleVehicleFallbackSeconds * 1000) }
      : { lt: new Date(now.getTime() - config.staleVehicleFallbackSeconds * 1000) } } },
  });
  return clauses;
}

function decorateStatus(vehicle, now = Date.now()) {
  const lastUpdated = vehicle.state?.updatedAt?.getTime();
  if (!lastUpdated) return { ...vehicle, connectivityStatus: 'OFFLINE' };
  const threshold = config.staleThresholdFor(vehicle.source) * 1000;
  return { ...vehicle, connectivityStatus: now - lastUpdated <= threshold ? 'ACTIVE' : 'STALE' };
}

async function list(organizationId, query) {
  const options = parseListQuery(query);
  if (options.cursor) {
    const cursorVehicle = await vehicleRepository.findById(organizationId, options.cursor);
    if (!cursorVehicle) {
      throw new AppError(400, 'INVALID_CURSOR', 'cursor does not identify a vehicle in this organization.');
    }
  }
  const page = await vehicleRepository.findPage(organizationId, {
    ...options,
    ...(options.status && { statusWhere: statusFilter(options.status) }),
  });
  return { ...page, items: page.items.map((vehicle) => decorateStatus(vehicle)) };
}

async function get(organizationId, id) {
  validateId(id);
  const vehicle = await vehicleRepository.findById(organizationId, id);
  if (!vehicle) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  return decorateStatus(vehicle);
}

async function update(organizationId, id, input) {
  validateId(id);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'source') {
    throw new AppError(400, 'INVALID_UPDATE', 'Only source may be updated.');
  }
  validateSource(input.source);

  const result = await vehicleRepository.update(organizationId, id, { source: input.source });
  if (result.count === 0) throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle was not found.');
  return vehicleRepository.findById(organizationId, id);
}

module.exports = { get, list, register, update };
