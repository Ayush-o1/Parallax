'use strict';

const bcrypt = require('bcryptjs');
const { randomUUID } = require('node:crypto');
const config = require('../config/env');
const prisma = require('../db/prisma');

const DUMMY_HASH = bcrypt.hashSync('not-a-real-secret-for-timing-equalization', 10);

async function issueToken({ grant_type: grantType, client_id: clientId, client_secret: clientSecret }) {
  if (grantType !== 'client_credentials' || typeof clientId !== 'string' || typeof clientSecret !== 'string') {
    const error = new Error('Use grant_type=client_credentials with a client_id and client_secret.');
    error.status = 400;
    error.code = 'INVALID_GRANT';
    throw error;
  }
  const client = await prisma.apiClient.findUnique({ where: { clientId } });
  const secretMatches = await bcrypt.compare(clientSecret, client?.secretHash || DUMMY_HASH);
  if (!client || client.revokedAt || !secretMatches) {
    const error = new Error('Client credentials are invalid or revoked.');
    error.status = 401;
    error.code = 'INVALID_CLIENT';
    throw error;
  }
  const { SignJWT } = await import('jose');
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ org: client.organizationId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(client.id)
    .setJti(randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + config.accessTokenSeconds)
    .sign(Buffer.from(config.tokenSigningSecret));
  return { access_token: token, token_type: 'Bearer', expires_in: config.accessTokenSeconds };
}

module.exports = { issueToken };
