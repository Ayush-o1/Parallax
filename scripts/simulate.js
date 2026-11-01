'use strict';

const { startSimulator, DEFAULT_INTERVALS } = require('../src/simulators');

const source = process.env.SIM_SOURCE || 'OEM_ALPHA';
const count = Number(process.env.SIM_VEHICLES || 3);
const speedMultiplier = Number(process.env.SIM_SPEED || 1);
const endpoint = process.env.INGEST_URL || 'http://localhost:3000/api/v1/ingest';
const token = process.env.PARALLAX_TOKEN;

function makeVin(index) {
  const suffix = `${index}`.padStart(6, '0');
  return `1HGBH41JXMN${suffix}`.slice(0, 17).padEnd(17, '1');
}

async function deliver({ source: eventSource, vin, payload, copies = 1, kind }) {
  if (!payload) return;
  // The simulator uses the actual public HTTP contract; it never writes DB rows directly.
  for (let i = 0; i < copies; i += 1) {
    const response = await fetch(`${endpoint}/${eventSource}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(payload),
    });
    process.stdout.write(`${eventSource} ${vin} ${kind}: ${response.status}\n`);
  }
}

async function registerVehicles(vehicles) {
  for (const vehicleVin of vehicles) {
    const response = await fetch(`${endpoint.replace(/\/api\/v1\/ingest$/, '')}/api/v1/vehicles`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ vin: vehicleVin, source }),
    });
    if (![201, 409].includes(response.status)) throw new Error(`Could not register ${vehicleVin} (${response.status}).`);
  }
}

if (!Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
  throw new Error('SIM_VEHICLES must be 1..500 and SIM_SPEED must be positive.');
}

async function main() {
  if (!DEFAULT_INTERVALS[source]) throw new Error(`SIM_SOURCE must be OEM_ALPHA, OEM_BETA, or OEM_GAMMA.`);
  const vehicles = Array.from({ length: count }, (_, i) => makeVin(i + 1));
  await registerVehicles(vehicles);
  const stop = startSimulator({
    source, vehicles,
    intervalMs: Number(process.env.SIM_INTERVAL_MS) || DEFAULT_INTERVALS[source],
    speedMultiplier,
    onEvent: deliver,
  });
  process.stdout.write(`Simulating ${source}: ${count} VINs at ${speedMultiplier}x to ${endpoint}\n`);
  process.on('SIGINT', () => { stop(); process.exit(0); });
  process.on('SIGTERM', () => { stop(); process.exit(0); });
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
