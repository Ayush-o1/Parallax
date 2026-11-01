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
      organizationId: orgA.id, name: 'test client A', clientId: `client-a-${suffix}`, secretHash: await bcrypt.hash(secretA, 4), role: 'ADMIN',
    } });
    clientB = await prisma.apiClient.create({ data: {
      organizationId: orgB.id, name: 'test client B', clientId: `client-b-${suffix}`, secretHash: await bcrypt.hash(secretB, 4), role: 'VIEWER',
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

  it('authenticates Socket.IO handshakes against the same tenant credential', async () => {
    const socketAuth = require('../../src/realtime/socketAuth');
    const socket = { handshake: { auth: { token: tokenA } }, data: {} };
    await new Promise((resolve, reject) => socketAuth(socket, (error) => error ? reject(error) : resolve()));
    assert.equal(socket.data.organizationId, orgA.id);
    assert.equal(socket.data.apiClientRole, 'ADMIN');

    const invalidSocket = { handshake: { auth: { token: 'invalid-token' } }, data: {} };
    await new Promise((resolve) => socketAuth(invalidSocket, (error) => {
      assert.match(error.message, /Unauthorized/);
      resolve();
    }));
  });

  it('rejects an unauthenticated Socket.IO handshake in production mode', () => {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, ['-e', `
      const socketAuth = require('./src/realtime/socketAuth');
      socketAuth({ handshake: { auth: {} }, data: {} }, (error) => {
        if (!error || error.message !== 'Unauthorized') process.exit(2);
      });
    `], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/dev/null' },
    });
    assert.equal(result.status, 0, result.stderr);
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

  it('enforces tenant-scoped API client roles for write operations', async () => {
    const forbiddenVehicleWrite = await supertest(app).post('/api/v1/vehicles')
      .set('authorization', `Bearer ${tokenB}`).send({ vin: makeVin(), source: 'OEM_ALPHA' });
    const forbiddenIngest = await supertest(app).post('/api/v1/ingest/OEM_ALPHA')
      .set('authorization', `Bearer ${tokenB}`).send({});
    assert.equal(forbiddenVehicleWrite.status, 403);
    assert.equal(forbiddenIngest.status, 403);
    assert.equal(forbiddenVehicleWrite.body.error.code, 'INSUFFICIENT_ROLE');
  });

  it('rejects expired bearer tokens', async () => {
    const { SignJWT } = await import('jose');
    const config = require('../../src/config/env');
    const expired = await new SignJWT({ org: orgA.id }).setProtectedHeader({ alg: 'HS256' })
      .setSubject(clientA.id).setIssuedAt(1).setExpirationTime(2).sign(Buffer.from(config.tokenSigningSecret));
    const response = await supertest(app).get('/api/v1/vehicles').set('authorization', `Bearer ${expired}`);
    assert.equal(response.status, 401);
  });
});
