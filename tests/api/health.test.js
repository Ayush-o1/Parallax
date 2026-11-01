/**
 * tests/api/health.test.js
 *
 * API-level tests for the /health endpoint.
 *
 * We use Node's built-in test runner (node:test) with supertest for
 * HTTP assertions. No Jest, no Mocha — this keeps our dev-dependency
 * count low and teaches you the standard library.
 *
 * Key concepts:
 *   - supertest(app) starts the Express app on a random port for each
 *     test, so tests never conflict with each other or with a running
 *     dev server.
 *   - We test both the HTTP contract (status code, Content-Type) and
 *     the response body shape.
 *   - We deliberately do not test the exact 'uptimeSeconds' value
 *     because it changes — testing that it is a non-negative number
 *     is sufficient and avoids flaky assertions.
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert   = require('node:assert/strict');
const supertest = require('supertest');

// Import the Express app — NOT server.js — so supertest manages the port.
const app = require('../../src/app');

describe('GET /health', () => {
  let request;

  before(() => {
    // supertest wraps the app and handles listen/close internally.
    request = supertest(app);
  });

  it('returns HTTP 200', async () => {
    const res = await request.get('/health');
    assert.equal(res.status, 200);
  });

  it('returns JSON content-type', async () => {
    const res = await request.get('/health');
    assert.match(res.headers['content-type'], /application\/json/);
  });

  it('response body has success:true', async () => {
    const res = await request.get('/health');
    assert.equal(res.body.success, true);
  });

  it('response body has status "ok"', async () => {
    const res = await request.get('/health');
    assert.equal(res.body.data.status, 'ok');
  });

  it('response body identifies the service as "parallax"', async () => {
    const res = await request.get('/health');
    assert.equal(res.body.data.service, 'parallax');
  });

  it('uptimeSeconds is a non-negative number', async () => {
    const res = await request.get('/health');
    const uptime = res.body.data.uptimeSeconds;
    assert.equal(typeof uptime, 'number');
    assert.ok(uptime >= 0);
  });

  it('timestamp is a valid ISO 8601 string', async () => {
    const res = await request.get('/health');
    const ts = res.body.data.timestamp;
    assert.ok(!isNaN(Date.parse(ts)), `Expected ISO timestamp, got: ${ts}`);
  });
});

describe('GET /nonexistent-route', () => {
  it('returns HTTP 404 for unknown routes', async () => {
    const request = supertest(app);
    const res = await request.get('/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
  });
});
