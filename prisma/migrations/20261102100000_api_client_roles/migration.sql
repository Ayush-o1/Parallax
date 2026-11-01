CREATE TYPE "api_client_role" AS ENUM ('VIEWER', 'INGESTOR', 'ADMIN');

ALTER TABLE "api_clients"
    ADD COLUMN "role" "api_client_role" NOT NULL DEFAULT 'VIEWER';

-- Preserve the existing privileges of pre-role API clients during rollout.
UPDATE "api_clients" SET "role" = 'ADMIN';
