'use strict';

const { makeScenario } = require('./scenario');

const DEFAULT_INTERVALS = { OEM_ALPHA: 30_000, OEM_BETA: 60_000, OEM_GAMMA: 15_000 };

/**
 * Deliver deterministic synthetic events to a callback until stopped.
 * The returned stop function lets tests and CLI shutdown close the loop.
 */
function startSimulator({ source, vehicles, intervalMs = DEFAULT_INTERVALS[source], speedMultiplier = 1, onEvent, now = () => new Date() }) {
  if (!DEFAULT_INTERVALS[source]) throw new Error(`Unsupported simulator source: ${source}`);
  if (!Array.isArray(vehicles) || vehicles.length === 0) throw new Error('At least one VIN is required.');
  if (typeof onEvent !== 'function') throw new Error('onEvent callback is required.');
  const delay = Math.max(1, Math.floor(intervalMs / speedMultiplier));
  let stopped = false;
  let sequence = 1;
  let index = 0;
  let timer;
  const pending = new Set();

  const tick = async () => {
    if (stopped) return;
    const vin = vehicles[index % vehicles.length];
    index += 1;
    const scenario = makeScenario(source, vin, sequence++, now(), intervalMs);
    if (scenario.kind !== 'disconnected') {
      const deliver = () => Promise.resolve(onEvent({ source, vin, ...scenario }));
      if (scenario.kind === 'delayed') {
        const delayed = new Promise((resolve, reject) => {
          const delayedTimer = setTimeout(() => deliver().then(resolve, reject), scenario.delayMs / speedMultiplier);
          pending.add(delayedTimer);
        });
        delayed.catch(() => {});
      } else if (scenario.kind === 'duplicate') {
        await deliver();
        await deliver();
      } else {
        await deliver();
      }
    }
    timer = setTimeout(tick, delay);
  };
  timer = setTimeout(tick, 0);

  return () => {
    stopped = true;
    clearTimeout(timer);
    for (const pendingTimer of pending) clearTimeout(pendingTimer);
  };
}

module.exports = { startSimulator, DEFAULT_INTERVALS };
