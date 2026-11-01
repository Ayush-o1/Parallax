'use strict';

const ingestionService = require('../services/ingestion.service');

async function ingest(req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const result = await ingestionService.ingest({
    organizationId: req.organizationId,
    source: req.params.source,
    rawBody,
    contentEncoding: req.get('content-encoding')?.toLowerCase(),
  });
  const status = result.status === 'MALFORMED' ? 400
    : result.status === 'PROCESSING' ? 202
    : result.status === 'COMPLETED_WITH_ERRORS' ? 207 : 200;
  return res.status(status).json({ success: result.status !== 'MALFORMED', data: result });
}

module.exports = { ingest };
