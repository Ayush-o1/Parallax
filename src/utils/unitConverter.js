'use strict';

const MPH_TO_KPH = 1.60934;

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    const error = new Error(`${field} must be a finite number.`);
    error.code = 'INVALID_MEASUREMENT';
    throw error;
  }
  return value;
}

module.exports = {
  finiteNumber,
  milesToKm: (value) => finiteNumber(value, 'odometer') * MPH_TO_KPH,
  mphToKph: (value) => finiteNumber(value, 'speed') * MPH_TO_KPH,
  metersPerSecondToKph: (value) => finiteNumber(value, 'velocity') * 3.6,
};
