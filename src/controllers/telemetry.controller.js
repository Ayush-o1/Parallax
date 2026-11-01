'use strict';

const telemetryService = require('../services/telemetry.service');

function send(promise, res) {
  return promise.then((result) => res.status(200).json({
    success: true,
    ...(result && result.items ? { data: result.items, page: result.page } : { data: result }),
  }));
}

module.exports = {
  state: (req, res) => send(telemetryService.state(req.organizationId, req.params.vehicleId), res),
  telemetry: (req, res) => send(telemetryService.telemetry(req.organizationId, req.params.vehicleId, req.query), res),
  events: (req, res) => send(telemetryService.events(req.organizationId, req.params.vehicleId, req.query), res),
  summary: (req, res) => send(telemetryService.summary(req.organizationId), res),
  history: (req, res) => send(telemetryService.history(req.organizationId, req.query), res),
  quarantines: (req, res) => send(telemetryService.quarantines(req.organizationId, req.query), res),
  recent: (req, res) => send(telemetryService.recentReadings(req.organizationId, req.query), res),
  recentEvents: (req, res) => send(telemetryService.recentEvents(req.organizationId, req.query), res),
};
