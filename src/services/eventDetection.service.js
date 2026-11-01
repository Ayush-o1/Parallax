'use strict';

const config = require('../config/env');

function key(type, vehicleId, source, triggerId) {
  return `${type}:${vehicleId}:${source}:${triggerId}`;
}

/** Build and persist deterministic operational events inside the telemetry transaction. */
async function detect(tx, { vehicleId, reading, previous, isNewer, odometerSuspicious }) {
  const candidates = [];
  const speed = Number(reading.speedKph);
  const previousSpeed = previous ? Number(previous.latestReading.speedKph) : 0;

  if (reading.source === 'OEM_BETA' && reading.accelMss !== null && Number(reading.accelMss) <= config.hardBrakingAccelMss) {
    candidates.push({ type: 'HARD_BRAKING', severity: Number(reading.accelMss) <= config.hardBrakingAccelMss * 1.7 ? 'HIGH' : 'MEDIUM', trigger: reading.externalEventId,
      explanation: `Longitudinal acceleration reached ${reading.accelMss} m/s².` });
  }

  if (isNewer && speed >= config.tripStartSpeedKph && (!previous || previousSpeed < config.tripStartSpeedKph)) {
    candidates.push({ type: 'TRIP_STARTED', severity: 'INFO', trigger: reading.externalEventId,
      explanation: `Vehicle speed crossed ${config.tripStartSpeedKph} km/h.` });
  }

  if (isNewer && speed < config.tripStartSpeedKph && previous && previousSpeed < config.tripStartSpeedKph) {
    const stationary = await stationaryEpisode(tx, vehicleId, reading.eventTime, config.tripStartSpeedKph, false);
    const stationarySeconds = stationary ? (reading.eventTime.getTime() - stationary.eventTime.getTime()) / 1000 : 0;
    if (stationarySeconds >= config.tripEndStationarySeconds) {
      candidates.push({ type: 'TRIP_ENDED', severity: 'INFO', trigger: stationary.externalEventId,
        explanation: `Vehicle remained below ${config.tripStartSpeedKph} km/h for ${Math.floor(stationarySeconds)} seconds.` });
    }
  }

  if (isNewer && odometerSuspicious) {
    candidates.push({ type: 'SUSPICIOUS_TELEMETRY', severity: 'WARNING', trigger: reading.externalEventId,
      explanation: 'A newer reading reported an odometer below the trusted value.' });
  }

  if (isNewer && reading.engineOn === true && speed < 1) {
    const stationary = await stationaryEpisode(tx, vehicleId, reading.eventTime, 1, true);
    const stationarySeconds = stationary ? (reading.eventTime.getTime() - stationary.eventTime.getTime()) / 1000 : 0;
    if (stationarySeconds >= config.idlingThresholdSeconds) {
      candidates.push({ type: 'EXCESSIVE_IDLING', severity: 'MEDIUM', trigger: stationary.externalEventId,
        explanation: `Engine-on stationary period exceeded ${config.idlingThresholdSeconds} seconds.` });
    }
  }

  if (!candidates.length) return [];
  const created = await tx.derivedEvent.createMany({
    data: candidates.map((event) => ({
      vehicleId,
      sourceReadingId: reading.id,
      eventType: event.type,
      severity: event.severity,
      dedupeKey: key(event.type, vehicleId, reading.source, event.trigger),
      occurredAt: reading.eventTime,
      explanation: event.explanation,
    })),
    skipDuplicates: true,
  });
  return created.count ? candidates : [];
}

async function stationaryEpisode(tx, vehicleId, eventTime, speedThreshold, requireEngineOn) {
  const history = await tx.telemetryReading.findMany({
    where: { vehicleId, eventTime: { lte: eventTime } },
    orderBy: { eventTime: 'desc' },
    take: 1000,
    select: { externalEventId: true, eventTime: true, speedKph: true, engineOn: true },
  });
  const episode = [];
  for (const reading of history) {
    const stationary = Number(reading.speedKph) < speedThreshold && (!requireEngineOn || reading.engineOn === true);
    if (!stationary) break;
    episode.push(reading);
  }
  return episode.at(-1) || null;
}

module.exports = { detect, key };
