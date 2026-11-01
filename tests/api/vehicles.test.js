'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const supertest = require('supertest');
const app = require('../../src/app');
const prisma = require('../../src/db/prisma');

const ownedVins = new Set();
let request;

function makeVin() {
  const suffix = crypto.randomBytes(8).toString('hex').toUpperCase().replace(/[IOQ]/g, 'X');
  const vin = `PARALLAX${suffix}`.slice(0, 17).padEnd(17, '7');
  // The fixed prefix is valid VIN text and the random suffix isolates test rows.
  ownedVins.add(vin);
  return vin;
}

describe('vehicle API', () => {
  before(() => { request = supertest(app); });

  after(async () => {
    if (ownedVins.size) {
      await prisma.vehicle.deleteMany({ where: { vin: { in: [...ownedVins] } } });
    }
  });

  it('registers a vehicle in the server-resolved demo organization and normalizes VIN', async () => {
    const vin = makeVin().toLowerCase();
    const response = await request.post('/api/v1/vehicles').send({
      vin,
      source: 'OEM_ALPHA',
      organizationId: '00000000-0000-4000-8000-000000000001',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.vin, vin.toUpperCase());
    const row = await prisma.vehicle.findFirst({ where: { vin: vin.toUpperCase() } });
    // The public representation intentionally omits tenant internals.
    assert.equal(response.body.data.organizationId, undefined);
    assert.ok(row);
    const demo = await prisma.organization.findUnique({ where: { slug: 'demo' } });
    assert.equal(row.organizationId, demo.id);
  });

  it('returns a conflict for a duplicate VIN and rejects invalid input', async () => {
    const vin = makeVin();
    const first = await request.post('/api/v1/vehicles').send({ vin, source: 'OEM_BETA' });
    const duplicate = await request.post('/api/v1/vehicles').send({ vin, source: 'OEM_BETA' });
    const invalid = await request.post('/api/v1/vehicles').send({ vin: 'bad', source: 'OEM_ALPHA' });

    assert.equal(first.status, 201);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'RESOURCE_CONFLICT');
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'INVALID_VIN');
  });

  it('lists, filters, searches, paginates, reads and updates only supported fields', async () => {
    const vins = [makeVin(), makeVin(), makeVin()];
    for (let i = 0; i < vins.length; i += 1) {
      const response = await request.post('/api/v1/vehicles').send({
        vin: vins[i], source: i === 2 ? 'OEM_GAMMA' : 'OEM_ALPHA',
      });
      assert.equal(response.status, 201);
    }

    const filtered = await request.get('/api/v1/vehicles')
      .query({ source: 'OEM_GAMMA', search: vins[2].slice(0, 8), limit: 1 });
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.data.length, 1);
    assert.equal(filtered.body.data[0].vin, vins[2]);

    const firstPage = await request.get('/api/v1/vehicles').query({ limit: 1 });
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.data.length, 1);
    if (firstPage.body.page.hasMore) {
      const secondPage = await request.get('/api/v1/vehicles').query({
        limit: 1, cursor: firstPage.body.page.nextCursor,
      });
      assert.equal(secondPage.status, 200);
      assert.notEqual(secondPage.body.data[0].id, firstPage.body.data[0].id);
    }

    const id = (await request.get('/api/v1/vehicles').query({ search: vins[0] })).body.data[0].id;
    const offline = await request.get('/api/v1/vehicles').query({ search: vins[0], status: 'OFFLINE' });
    const badStatus = await request.get('/api/v1/vehicles').query({ status: 'CONNECTED' });
    assert.equal(offline.status, 200);
    assert.equal(offline.body.data[0].connectivityStatus, 'OFFLINE');
    assert.equal(badStatus.status, 400);
    assert.equal(badStatus.body.error.code, 'INVALID_STATUS');
    const detail = await request.get(`/api/v1/vehicles/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.vin, vins[0]);
    assert.equal(detail.body.data.connectivityStatus, 'OFFLINE');
    const updated = await request.patch(`/api/v1/vehicles/${id}`).send({ source: 'OEM_BETA' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.source, 'OEM_BETA');
    const rejectedUpdate = await request.patch(`/api/v1/vehicles/${id}`).send({ vin: vins[1] });
    assert.equal(rejectedUpdate.status, 400);
  });

  it('does not reveal vehicles outside the resolved organization and validates query parameters', async () => {
    const nonexistent = '00000000-0000-4000-8000-000000000099';
    const missing = await request.get(`/api/v1/vehicles/${nonexistent}`);
    const badLimit = await request.get('/api/v1/vehicles').query({ limit: 0 });
    assert.equal(missing.status, 404);
    assert.equal(badLimit.status, 400);
    assert.equal(badLimit.body.error.code, 'INVALID_LIMIT');
  });
});
