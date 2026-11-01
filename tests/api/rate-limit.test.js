'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

describe('authentication rate limit', () => {
  it('returns a consistent 429 response after the configured token limit', () => {
    const result = spawnSync(process.execPath, ['-e', `
      const request = require('supertest');
      const app = require('./src/app');
      (async () => {
        const statuses = [];
        for (let index = 0; index < 3; index += 1) {
          const response = await request(app).post('/api/v1/auth/token').send({
            grant_type: 'client_credentials', client_id: 'rate-limit-missing-client', client_secret: 'invalid',
          });
          statuses.push({ status: response.status, body: response.body });
        }
        process.stdout.write(JSON.stringify(statuses));
      })().catch((error) => { process.stderr.write(error.stack); process.exit(2); });
    `], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, API_RATE_LIMIT_PER_MINUTE: '100', TOKEN_RATE_LIMIT: '2', LOG_LEVEL: 'warn' },
    });
    assert.equal(result.status, 0, result.stderr);
    const responses = JSON.parse(result.stdout);
    assert.deepEqual(responses.map((response) => response.status), [401, 401, 429]);
    assert.equal(responses[2].body.error.code, 'RATE_LIMITED');
    assert.ok(responses[2].body.error.requestId);
  });
});
