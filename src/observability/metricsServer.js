'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const config = require('../config/env');
const { registry } = require('../middleware/requestMetrics');

function authorized(request) {
  if (!config.isProduction()) return true;
  const expected = process.env.METRICS_TOKEN || '';
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return Boolean(expected && expectedBytes.length === suppliedBytes.length
    && crypto.timingSafeEqual(expectedBytes, suppliedBytes));
}

/** Expose process-local metrics so queue and stream workers can be scraped independently. */
function startMetricsServer({ port, host = '0.0.0.0' }) {
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    if (!authorized(request)) {
      response.writeHead(404).end();
      return;
    }
    try {
      response.writeHead(200, { 'content-type': registry.contentType });
      response.end(await registry.metrics());
    } catch {
      response.writeHead(500).end();
    }
  });
  server.listen(port, host);
  return () => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

module.exports = { startMetricsServer };
