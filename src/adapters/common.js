'use strict';

const { finiteNumber } = require('../utils/unitConverter');

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

function requiredString(value, field, maxLength = 256) {
  if (typeof value !== 'string' || value.trim() === '' || value.trim().length > maxLength) {
    const error = new Error(`${field} must be a non-empty string.`);
    error.code = 'INVALID_FIELD';
    throw error;
  }
  return value.trim();
}

function validateVin(value) {
  const vin = requiredString(value, 'vin').toUpperCase();
  if (!VIN_PATTERN.test(vin)) {
    const error = new Error('vin must contain 17 valid VIN characters.');
    error.code = 'INVALID_VIN';
    throw error;
  }
  return vin;
}

function requiredNumber(value, field, min, max) {
  const result = finiteNumber(value, field);
  if (result < min || result > max) {
    const error = new Error(`${field} must be between ${min} and ${max}.`);
    error.code = 'OUT_OF_RANGE';
    throw error;
  }
  return result;
}

function parseTimestamp(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    const error = new Error(`${field} must be a valid ISO timestamp.`);
    error.code = 'INVALID_EVENT_TIME';
    throw error;
  }
  return new Date(value);
}

function canonical({ source, externalEventId, vin, eventTime, speedKph, odometerKm, fuelPercent, latitude, longitude, engineOn = null, accelMss = null }) {
  return {
    source,
    externalEventId: requiredString(externalEventId, 'event identifier', 180),
    vin: validateVin(vin),
    eventTime,
    speedKph: requiredNumber(speedKph, 'speedKph', 0, 400),
    odometerKm: odometerKm === null ? null : requiredNumber(odometerKm, 'odometerKm', 0, 10_000_000),
    fuelPercent: requiredNumber(fuelPercent, 'fuelPercent', 0, 100),
    latitude: requiredNumber(latitude, 'latitude', -90, 90),
    longitude: requiredNumber(longitude, 'longitude', -180, 180),
    engineOn: engineOn === undefined ? null : engineOn,
    accelMss: accelMss === undefined || accelMss === null ? null : requiredNumber(accelMss, 'accelMss', -100, 100),
  };
}

module.exports = { canonical, parseTimestamp, requiredString, requiredNumber };
