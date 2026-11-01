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
    if (typeof payload.sub !== 'string' || typeof payload.org !== 'string' || !Number.isInteger(payload.exp)) {
      throw new Error('Invalid token claims.');
    }
    const client = await prisma.apiClient.findFirst({
      where: { id: payload.sub, revokedAt: null },
      select: { id: true, organizationId: true, role: true },
    });
    if (!client || client.organizationId !== payload.org) throw new Error('Invalid or revoked token.');
    socket.data.organizationId = client.organizationId;
    socket.data.apiClientId = client.id;
    socket.data.apiClientRole = client.role;

    // REST authorization checks revocation on every request. A socket is
    // long-lived, so recheck its client periodically and close it at token
    // expiry. Fail closed if the authorization lookup cannot be completed.
    if (typeof socket.disconnect === 'function') {
      let checking = false;
      const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, payload.exp * 1000 - Date.now()));
      const revocationTimer = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          const active = await prisma.apiClient.findFirst({
            where: { id: client.id, organizationId: client.organizationId, role: client.role, revokedAt: null },
            select: { id: true },
          });
          if (!active) socket.disconnect(true);
        } catch {
          socket.disconnect(true);
        } finally {
          checking = false;
        }
      }, 15_000);
      expiryTimer.unref?.();
      revocationTimer.unref?.();
      socket.once?.('disconnect', () => {
        clearTimeout(expiryTimer);
        clearInterval(revocationTimer);
      });
    }
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
}

module.exports = socketAuth;
