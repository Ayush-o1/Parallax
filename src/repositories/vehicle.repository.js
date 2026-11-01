'use strict';

const prisma = require('../db/prisma');

const vehicleSelect = {
  id: true,
  vin: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  state: { select: {
    updatedAt: true,
    lastEventTime: true,
    trustedOdometerKm: true,
    latestReading: { select: {
      eventTime: true, speedKph: true, fuelPercent: true, latitude: true, longitude: true,
      engineOn: true, odometerSuspicious: true,
    } },
  } },
};

function create(organizationId, data) {
  return prisma.vehicle.create({
    data: { organizationId, ...data },
    select: vehicleSelect,
  });
}

function findById(organizationId, id) {
  return prisma.vehicle.findFirst({
    where: { id, organizationId },
    select: vehicleSelect,
  });
}

function update(organizationId, id, data) {
  return prisma.vehicle.updateMany({
    where: { id, organizationId },
    data,
  });
}

async function findPage(organizationId, { limit, cursor, search, source, statusWhere }) {
  const where = {
    organizationId,
    ...(source && { source }),
    ...(search && { vin: { contains: search, mode: 'insensitive' } }),
    ...(statusWhere && { OR: statusWhere }),
  };

  const rows = await prisma.vehicle.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: vehicleSelect,
  });

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  return {
    items: rows,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? rows.at(-1).id : null,
    },
  };
}

module.exports = { create, findById, findPage, update };
