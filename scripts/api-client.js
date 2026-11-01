'use strict';

require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const config = require('../src/config/env');

async function main() {
  config.validateConfig();
  process.env.DATABASE_URL = config.databaseUrl;
  const prisma = new PrismaClient();
  try {
    const [action, argument, name, requestedRole = 'VIEWER'] = process.argv.slice(2);
    if (action === 'create') {
      if (!argument || !name) throw new Error('Usage: npm run client:create -- <organization-slug> <client-name> [VIEWER|INGESTOR|ADMIN]');
      if (!['VIEWER', 'INGESTOR', 'ADMIN'].includes(requestedRole)) throw new Error('Role must be VIEWER, INGESTOR, or ADMIN.');
      const organization = await prisma.organization.findUnique({ where: { slug: argument } });
      if (!organization) throw new Error(`Organization not found: ${argument}`);
      const clientId = `px_${crypto.randomUUID()}`;
      const clientSecret = crypto.randomBytes(32).toString('base64url');
      await prisma.apiClient.create({ data: {
        organizationId: organization.id,
        name,
        role: requestedRole,
        clientId,
        secretHash: await bcrypt.hash(clientSecret, 12),
      } });
      // Secret is shown only at creation; the DB stores only its bcrypt hash.
      process.stdout.write(`${JSON.stringify({ clientId, clientSecret, role: requestedRole }, null, 2)}\n`);
    } else if (action === 'revoke') {
      if (!argument) throw new Error('Usage: npm run client:revoke -- <client-id>');
      const result = await prisma.apiClient.updateMany({
        where: { clientId: argument, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count !== 1) throw new Error('Active client ID not found.');
      process.stdout.write('API client revoked.\n');
    } else {
      throw new Error('Choose create or revoke.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
