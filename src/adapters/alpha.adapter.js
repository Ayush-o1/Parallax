'use strict';

const { mphToKph, milesToKm } = require('../utils/unitConverter');
const { canonical, parseTimestamp, requiredNumber, requiredString } = require('./common');

function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('OEM Alpha event must be an object.');
  if (payload.speed_unit !== 'mph') throw new Error('OEM Alpha speed_unit must be mph.');
  if (payload.engine_on !== undefined && typeof payload.engine_on !== 'boolean') throw new Error('engine_on must be a boolean.');
  return canonical({
    source: 'OEM_ALPHA', externalEventId: requiredString(payload.event_id, 'event_id'),
    vin: payload.vin, eventTime: parseTimestamp(payload.timestamp, 'timestamp'),
    speedKph: mphToKph(payload.speed), odometerKm: milesToKm(payload.odometer),
    fuelPercent: payload.fuel_level, latitude: payload.latitude, longitude: payload.longitude,
    engineOn: payload.engine_on ?? null,
  });
}

module.exports = { normalize };
