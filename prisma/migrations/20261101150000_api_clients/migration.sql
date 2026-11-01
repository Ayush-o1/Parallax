CREATE TABLE "api_clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "client_id" VARCHAR(100) NOT NULL,
    "secret_hash" VARCHAR(100) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_clients_client_id_key" ON "api_clients"("client_id");
CREATE INDEX "api_clients_organization_id_revoked_at_idx" ON "api_clients"("organization_id", "revoked_at");

ALTER TABLE "api_clients"
    ADD CONSTRAINT "api_clients_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
