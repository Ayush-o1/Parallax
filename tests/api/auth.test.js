'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const supertest = require('supertest');
const app = require('../../src/app');
const prisma = require('../../src/db/prisma');

const VIN_CHARS = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
function makeVin() { return [...crypto.randomBytes(17)].map((byte) => VIN_CHARS[byte % VIN_CHARS.length]).join(''); }

describe('client credentials and tenant authorization', () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  let orgA;
  let orgB;
  let clientA;
  let clientB;
  let vehicleB;
  let tokenA;
  let tokenB;
  const secretA = crypto.randomBytes(24).toString('base64url');
  const secretB = crypto.randomBytes(24).toString('base64url');

  before(async () => {
    orgA = await prisma.organization.create({ data: { slug: `auth-a-${suffix}`, name: 'Auth A' } });
    orgB = await prisma.organization.create({ data: { slug: `auth-b-${suffix}`, name: 'Auth B' } });
    clientA = await prisma.apiClient.create({ data: {
      organizationId: orgA.id, name: 'test client A', clientId: `client-a-${suffix}`, secretHash: await bcrypt.hash(secretA, 4),
    } });
    clientB = await prisma.apiClient.create({ data: {
      organizationId: orgB.id, name: 'test client B', clientId: `client-b-${suffix}`, secretHash: await bcrypt.hash(secretB, 4),
    } });
    vehicleB = await prisma.vehicle.create({ data: { organizationId: orgB.id, vin: makeVin(), source: 'OEM_ALPHA' } });
    const tokenResponseA = await supertest(app).post('/api/v1/auth/token').send({
      grant_type: 'client_credentials', client_id: clientA.clientId, client_secret: secretA,
    });
    const tokenResponseB = await supertest(app).post('/api/v1/auth/token').send({
      grant_type: 'client_credentials', client_id: clientB.clientId, client_secret: secretB,
    });
    assert.equal(tokenResponseA.status, 200);
    assert.equal(tokenResponseB.status, 200);
    tokenA = tokenResponseA.body.data.access_token;
    tokenB = tokenResponseB.body.data.access_token;
  });

  after(async () => {
    if (vehicleB) await prisma.vehicle.deleteMany({ where: { id: vehicleB.id } });
    if (clientA || clientB) await prisma.apiClient.deleteMany({ where: { id: { in: [clientA?.id, clientB?.id].filter(Boolean) } } });
    if (orgA || orgB) await prisma.organization.deleteMany({ where: { id: { in: [orgA?.id, orgB?.id].filter(Boolean) } } });
  });

  it('issues access tokens only for valid client credentials', async () => {
    const invalid = await supertest(app).post('/api/v1/auth/token').send({
      grant_type: 'client_credentials', client_id: clientA.clientId, client_secret: 'wrong',
    });
    assert.equal(invalid.status, 401);
    assert.equal(typeof tokenA, 'string');
  });

  it('uses the credential tenant and rejects cross-organization vehicle reads', async () => {
    const hidden = await supertest(app).get(`/api/v1/vehicles/${vehicleB.id}`).set('authorization', `Bearer ${tokenA}`);
    assert.equal(hidden.status, 404);
    const visible = await supertest(app).get(`/api/v1/vehicles/${vehicleB.id}`).set('authorization', `Bearer ${tokenB}`);
    assert.equal(visible.status, 200);
  });

  it('ignores client-supplied organization IDs and applies credential revocation immediately', async () => {
    const vin = makeVin();
    const created = await supertest(app).post('/api/v1/vehicles').set('authorization', `Bearer ${tokenA}`).send({
      vin, source: 'OEM_ALPHA', organizationId: orgB.id,
    });
    assert.equal(created.status, 201);
    const stored = await prisma.vehicle.findFirst({ where: { vin } });
    assert.equal(stored.organizationId, orgA.id);
    await prisma.apiClient.update({ where: { id: clientA.id }, data: { revokedAt: new Date() } });
    const revoked = await supertest(app).get('/api/v1/vehicles').set('authorization', `Bearer ${tokenA}`);
    assert.equal(revoked.status, 401);
    await prisma.vehicle.delete({ where: { id: stored.id } });
  });
});
