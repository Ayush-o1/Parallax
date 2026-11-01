'use strict';

const vehicleService = require('../services/vehicle.service');

async function register(req, res) {
  const vehicle = await vehicleService.register(req.organizationId, req.body);
  return res.status(201).json({ success: true, data: vehicle });
}

async function list(req, res) {
  const result = await vehicleService.list(req.organizationId, req.query);
  return res.status(200).json({ success: true, data: result.items, page: result.page });
}

async function get(req, res) {
  const vehicle = await vehicleService.get(req.organizationId, req.params.vehicleId);
  return res.status(200).json({ success: true, data: vehicle });
}

async function update(req, res) {
  const vehicle = await vehicleService.update(req.organizationId, req.params.vehicleId, req.body);
  return res.status(200).json({ success: true, data: vehicle });
}

module.exports = { get, list, register, update };
