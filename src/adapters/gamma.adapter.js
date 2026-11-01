'use strict';

const { metersPerSecondToKph } = require('../utils/unitConverter');
const { canonical, parseTimestamp, requiredNumber } = require('./common');

function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('OEM Gamma event must be an object.');
  if (payload.measurements?.velocity_unit !== 'm/s') throw new Error('OEM Gamma velocity_unit must be m/s.');
  const vin = payload.vehicle?.vin;
  const sequence = payload.vehicle?.seq;
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('vehicle.seq must be a non-negative safe integer.');
  return canonical({
    source: 'OEM_GAMMA', externalEventId: `GAMMA-${vin}-${sequence}`, vin,
    eventTime: parseTimestamp(payload.generated_at, 'generated_at'),
    speedKph: metersPerSecondToKph(payload.measurements.velocity), odometerKm: null,
    fuelPercent: payload.measurements.fuel,
    latitude: payload.position?.latitude, longitude: payload.position?.longitude,
  });
}

module.exports = { normalize };
