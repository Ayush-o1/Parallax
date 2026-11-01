'use strict';

const { makePayload } = require('./payloadFactory');

/** Deterministic scenario schedule keeps simulator runs reproducible. */
function makeScenario(source, vin, sequence, now, intervalMs) {
  const eventDate = new Date(now.getTime() - (sequence % 29 === 0 ? intervalMs * 3 : 0));
  const payload = makePayload(source, vin, sequence, eventDate);
  if (sequence % 31 === 0) {
    if (source === 'OEM_ALPHA') payload.fuel_level = 140;
    else if (source === 'OEM_BETA') payload.fuel_percent = 140;
    else payload.measurements.fuel = 140;
    return { kind: 'invalid', payload };
  }
  if (sequence % 37 === 0) return { kind: 'duplicate', payload, copies: 2 };
  if (sequence % 43 === 0) return { kind: 'delayed', payload, delayMs: intervalMs * 2 };
  if (sequence % 47 === 0) return { kind: 'disconnected', payload: null };
  if (sequence % 29 === 0) return { kind: 'out_of_order', payload };
  return { kind: 'normal', payload };
}

module.exports = { makeScenario };
