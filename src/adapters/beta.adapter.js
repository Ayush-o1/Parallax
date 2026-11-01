'use strict';

const { canonical, parseTimestamp, requiredNumber } = require('./common');

function normalize(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('OEM Beta event must be an object.');
  if (payload.unit !== 'km/h' || payload.distance_unit !== 'km') throw new Error('OEM Beta units must be km/h and km.');
  return canonical({
    source: 'OEM_BETA', externalEventId: payload.message_id, vin: payload.vehicleId,
    eventTime: parseTimestamp(payload.event_timestamp, 'event_timestamp'),
    speedKph: requiredNumber(payload.vehicle_speed, 'vehicle_speed', 0, 400),
    odometerKm: requiredNumber(payload.distance, 'distance', 0, 10_000_000),
    fuelPercent: payload.fuel_percent, latitude: payload.lat, longitude: payload.lng,
    accelMss: payload.accel_mss ?? null,
  });
}

module.exports = { normalize };
