'use strict';

const prisma = require('../db/prisma');
const { Prisma } = require('@prisma/client');

function persistRequest({ organizationId, source, rawBody, contentEncoding }) {
  // This write commits before parsing begins. A later parse or worker failure
  // therefore cannot erase the byte-for-byte receipt record.
  return prisma.ingestionRequest.create({ data: { organizationId, source, rawBody, contentEncoding } });
}

async function markMalformed(requestId, source, code, detail) {
  return prisma.$transaction(async (tx) => {
    await tx.quarantineRecord.create({ data: {
      requestId, source, reason: code, detail,
    } });
    return tx.ingestionRequest.update({
      where: { id: requestId },
      data: { status: 'MALFORMED', errorCode: code, errorDetail: detail, completedAt: new Date() },
    });
  });
}

async function createEvents(requestId, source, items, parsedPayload) {
  return prisma.$transaction(async (tx) => {
    await tx.ingestionRequest.update({
      where: { id: requestId },
      data: { status: 'PROCESSING', parsedPayload: parsedPayload === null ? Prisma.JsonNull : parsedPayload, parsedAt: new Date() },
    });
    return Promise.all(items.map((payload, ordinal) => tx.ingestionEvent.create({
      data: {
        requestId, source, ordinal,
        payload: payload === null ? Prisma.JsonNull : payload,
        rawVin: typeof payload?.vin === 'string' ? payload.vin
          : typeof payload?.vehicleId === 'string' ? payload.vehicleId
            : typeof payload?.vehicle?.vin === 'string' ? payload.vehicle.vin : null,
      },
    })));
  });
}

async function finalizeRequest(requestId) {
  const events = await prisma.ingestionEvent.findMany({ where: { requestId }, select: { status: true } });
  const hasErrors = events.some(({ status }) => ['QUARANTINED', 'ACCEPTED_WITH_WARNINGS'].includes(status));
  return prisma.ingestionRequest.update({
    where: { id: requestId },
    data: { status: hasErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', completedAt: new Date() },
  });
}

module.exports = { createEvents, finalizeRequest, markMalformed, persistRequest };
