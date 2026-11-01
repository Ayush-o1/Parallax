'use strict';

const config = require('../config/env');
const prisma = require('../db/prisma');

async function socketAuth(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token && !config.isProduction()) {
      const demo = await prisma.organization.findUnique({ where: { slug: 'demo' } });
      if (!demo) throw new Error('Demo organization is not seeded.');
      socket.data.organizationId = demo.id;
      return next();
    }
    if (!token) throw new Error('Authentication required.');
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, Buffer.from(config.tokenSigningSecret), { algorithms: ['HS256'] });
    const client = await prisma.apiClient.findFirst({ where: { id: payload.sub, revokedAt: null } });
    if (!client || client.organizationId !== payload.org) throw new Error('Invalid or revoked token.');
    socket.data.organizationId = client.organizationId;
    socket.data.apiClientId = client.id;
    socket.data.apiClientRole = client.role;
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
}

module.exports = socketAuth;
