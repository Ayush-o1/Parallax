'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const alpha = require('../../src/adapters/alpha.adapter');
const beta = require('../../src/adapters/beta.adapter');
const gamma = require('../../src/adapters/gamma.adapter');

const vin = '1HGBH41JXMN109186';
const timestamp = '2026-11-01T08:30:00.000Z';

describe('OEM adapters', () => {
  it('converts Alpha imperial measurements and retains optional engine state', () => {
    const result = alpha.normalize({
      vin, speed: 60, speed_unit: 'mph', odometer: 10, latitude: 12, longitude: 77,
      fuel_level: 75, engine_on: false, event_id: 'A-1', timestamp,
    });
    assert.equal(result.speedKph, 96.5604);
    assert.equal(result.odometerKm, 16.0934);
    assert.equal(result.engineOn, false);
    assert.equal(result.accelMss, null);
  });

  it('validates Beta units and preserves its acceleration signal', () => {
    const result = beta.normalize({
      vehicleId: vin, vehicle_speed: 10, unit: 'km/h', distance: 20, distance_unit: 'km',
      lat: 12, lng: 77, fuel_percent: 50, accel_mss: -4.2, message_id: 'B-1', event_timestamp: timestamp,
    });
    assert.equal(result.speedKph, 10);
    assert.equal(result.accelMss, -4.2);
    assert.throws(() => beta.normalize({ unit: 'mph' }), /units must be km\/h and km/);
  });

  it('normalizes nested Gamma sequence IDs and leaves unsupported odometer null', () => {
    const result = gamma.normalize({
      vehicle: { vin, seq: 30001 }, measurements: { velocity: 10, velocity_unit: 'm/s', fuel: 58 },
      position: { latitude: 12, longitude: 77 }, generated_at: timestamp,
    });
    assert.equal(result.speedKph, 36);
    assert.equal(result.externalEventId, `GAMMA-${vin}-30001`);
    assert.equal(result.odometerKm, null);
  });

  it('rejects out-of-range coordinates and invalid event identifiers', () => {
    assert.throws(() => alpha.normalize({
      vin, speed: 10, speed_unit: 'mph', odometer: 10, latitude: 91, longitude: 77,
      fuel_level: 75, event_id: 'A-1', timestamp,
    }), /latitude must be between/);
    assert.throws(() => gamma.normalize({
      vehicle: { vin, seq: -1 }, measurements: { velocity: 1, velocity_unit: 'm/s', fuel: 50 },
      position: { latitude: 12, longitude: 77 }, generated_at: timestamp,
    }), /non-negative safe integer/);
  });
});
