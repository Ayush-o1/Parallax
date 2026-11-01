'use strict';

function makePayload(source, vin, sequence, date) {
  const t = date.toISOString();
  const speed = 35 + ((sequence * 13) % 80);
  const fuel = 95 - (sequence % 70);
  const lat = 12.95 + ((sequence % 100) / 10000);
  const lon = 77.58 + ((sequence % 100) / 10000);
  if (source === 'OEM_ALPHA') {
    return {
      vin, speed: speed / 1.60934, speed_unit: 'mph', odometer: 12000 + sequence / 100,
      latitude: lat, longitude: lon, fuel_level: fuel, engine_on: speed > 0,
      event_id: `ALPHA-${vin}-${sequence}`, timestamp: t,
    };
  }
  if (source === 'OEM_BETA') {
    return {
      vehicleId: vin, vehicle_speed: speed, unit: 'km/h', distance: 19000 + sequence / 100,
      distance_unit: 'km', lat, lng: lon, fuel_percent: fuel, accel_mss: sequence % 17 === 0 ? -4.5 : 0.2,
      message_id: `BETA-${vin}-${sequence}`, event_timestamp: t,
    };
  }
  if (source === 'OEM_GAMMA') {
    return {
      vehicle: { vin, seq: sequence },
      measurements: { velocity: speed / 3.6, velocity_unit: 'm/s', fuel },
      position: { latitude: lat, longitude: lon }, generated_at: t,
    };
  }
  throw new Error(`Unsupported simulator source: ${source}`);
}

module.exports = { makePayload };
