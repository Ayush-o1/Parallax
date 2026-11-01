# Deployment

This runbook covers a public synthetic-data demo on Render. The repository does not provision cloud resources. Review the Blueprint and current provider plans in Render before confirming creation; creating the Blueprint can incur charges. See [Render pricing](https://render.com/pricing).

## Topology

[`render.yaml`](../render.yaml) defines one Docker web service, one worker, PostgreSQL, and persistent Redis-compatible Key Value in Singapore. Web and worker use Render private connection strings for PostgreSQL and Redis. The database and Key Value have empty public IP allow-lists. Kafka is disabled; PostgreSQL remains authoritative. WebSocket traffic uses the web service's HTTPS origin.

Render runs `npm run db:migrate:prod` as the web service's pre-deploy command, before the new web process starts. After its first successful deploy, the web service's initial-deploy hook runs the idempotent `npm run db:seed:prod` command. Seeding creates or updates only the `demo` organization; it does not create clients or vehicles.

The Docker image contains the generated Prisma client, Prisma CLI, committed schema and migrations, runtime dependencies, server, worker, and client/simulator scripts. Both services use the same image with different Node commands. The image runs as the non-root `node` user. Render's web readiness path is `/health/ready`.

## First deployment

These steps require your Render account and approval of the resources and plans shown by Render.

1. Push the desired release to `main` and confirm [GitHub Actions](../.github/workflows/ci.yml) passes.
2. In the Render Dashboard, create a Blueprint from `Ayush-o1/Parallax`, branch `main`, file `render.yaml`. Review the web, worker, database, and Key Value services and their current plans before clicking **Apply**.
3. In each service's events/logs, verify the web pre-deploy migration succeeded, the first-deploy seed hook succeeded, and the worker started. Confirm the web URL returns HTTP 200 from `/health/ready` with database, Redis, and worker checks all `ok`.
4. Confirm the generated `TOKEN_SIGNING_SECRET` and `METRICS_TOKEN` exist on both web and worker and are each at least 32 bytes. Render generates 256-bit values for `generateValue: true`; keep them private. The two services' values need not match: the worker does not issue browser/API tokens. Do not copy secrets into Git.
5. Optionally add a custom domain to the web service using Render's DNS/TLS instructions. The `onrender.com` URL uses platform HTTPS.
6. In the Render web service's **Shell**, create the least-privilege clients. The command prints the secret once; save it securely:

   ```sh
   npm run client:create -- demo "Parallax dashboard" VIEWER
   npm run client:create -- demo "Synthetic telemetry" INGESTOR
   npm run client:create -- demo "Synthetic vehicle registration" ADMIN
   ```

   The Viewer credential is for dashboard sign-in. The Ingestor credential can submit telemetry. The temporary Admin credential is needed because the simulator registers its synthetic VINs before sending telemetry.

7. Exchange each client ID/secret at `POST /api/v1/auth/token` from a trusted machine. Use the returned access tokens as short-lived bearer credentials; never put the client secret or token in a URL. Example request:

   ```sh
   curl -fsS "https://<service-or-domain>/api/v1/auth/token" \
     -H 'content-type: application/json' \
     -d '{"grant_type":"client_credentials","client_id":"<client-id>","client_secret":"<one-time-secret>"}'
   ```

8. Open the dashboard HTTPS URL, choose **Connect**, and enter the Viewer client ID and secret. Verify that the API and realtime connection indicators become healthy.
9. Run the simulator from a trusted machine. Provide its Ingestor token for telemetry and its Admin token only for VIN registration:

   ```sh
   INGEST_URL="https://<service-or-domain>/api/v1/ingest" \
   PARALLAX_TOKEN="<ingestor-access-token>" \
   PARALLAX_ADMIN_TOKEN="<admin-access-token>" \
   SIM_SOURCE=OEM_ALPHA SIM_VEHICLES=2 SIM_INTERVAL_MS=5000 SIM_SPEED=20 \
   npm run simulate
   ```

   The simulator sends about four requests per second. Its deterministic schedule includes invalid fuel; within roughly eight seconds an invalid event is sent to quarantine. Accepted telemetry should appear in the dashboard, and the invalid event should appear in quarantine. The simulator prints HTTP statuses. Stop it with Ctrl-C.

10. Check recent telemetry, ingestion request outcomes, quarantine reason and payload, worker heartbeat, and browser console/network. Confirm `/health/ready` remains healthy and the Socket.IO connection stays connected while new readings arrive.
11. Revoke the temporary Admin client with `npm run client:revoke -- <client-id>` from the web service Shell when registration is complete. Retain Viewer and Ingestor clients only while needed; revoke them after the demo if appropriate.

The dashboard credentials/token are held in page memory and are cleared on reload or disconnect. Paste only the Viewer client credentials in the dashboard. The simulator tokens belong in the trusted simulator shell, not the dashboard.

## Environment variables

The Blueprint wires these values. Set or change them only in the Render service environment:

| Variable | Web | Worker | Notes |
|---|---:|---:|---|
| `NODE_ENV` | yes | yes | `production`; disables local demo authentication. |
| `DATABASE_URL` | yes | yes | Render private Postgres connection string. Must not target `parallax_dev` or `parallax_test`. |
| `REDIS_URL` | yes | yes | Render private Key Value connection string. Persistent storage and `noeviction` are configured. |
| `TOKEN_SIGNING_SECRET` | yes | yes | Generated per service, minimum 32 bytes. The web signs/verifies tokens. |
| `METRICS_TOKEN` | yes | yes | Generated per service, minimum 32 bytes. Protects each process's metrics endpoint. |
| `STREAMING_ENABLED` | yes | yes | Explicitly `false` in this topology. |
| `TRUST_PROXY_HOPS` | yes | yes | `1` for the Render proxy. |
| `WORKER_CONCURRENCY` | yes | yes | Starts at `4`; tune after measuring database and queue capacity. |
| `API_RATE_LIMIT_PER_MINUTE` | yes | — | Web default in the Blueprint is `300` per client IP. |
| `PORT` | platform | — | Supplied by Render; app binds to `0.0.0.0`. |

Other validated settings are listed in [`.env.example`](../.env.example). Do not enable streaming until a managed Kafka-compatible broker, credentials, network policy, and a separate publisher/consumer process are deployed.

## Post-deploy checks

Run these checks from a trusted terminal, replacing the service URL:

```sh
curl -i "https://<service-or-domain>/health/live"
curl -i "https://<service-or-domain>/health/ready"
curl -i "https://<service-or-domain>/api/v1/summary" -H "Authorization: Bearer <viewer-access-token>"
```

Readiness must show database, Redis, and worker checks as `ok`. Verify sign-in and a dashboard read, one accepted simulator event, an invalid event in quarantine, and live updates. Without authorization `/metrics` is intentionally unavailable in production.

## Costs and resource limits

Plan availability and pricing change; use [Render's current pricing](https://render.com/pricing) and the exact plans shown in the Blueprint review. This topology has four always-on resources (web, worker, PostgreSQL, and Key Value), plus database storage, backups, workspace charges, and any egress. The Blueprint is a small single-region demo configuration, not an HA deployment. Review instance memory, database connection limits, storage, backup/PITR options, and Key Value persistence before applying it. Do not multiply web or worker instances without recalculating database pools and confirming the app's shared-state requirements.

## Release and rollback

Render auto-deploys after GitHub checks pass. Migrations run before the new web version starts. Keep schema changes backward compatible across the rollout: add fields first, deploy code, migrate data if needed, then remove unused fields in a later release.

If application code fails, use Render's previous-deploy action only when its code is compatible with the current database schema. A code rollback does not roll back Prisma migrations. Do not run `migrate dev`, `db push`, or reset commands against the hosted database. For data recovery, restore a backup to a separate database, validate it, and then plan a connection switch.

## Backups and restore

Before keeping meaningful data, configure a backup/PITR plan in the provider Dashboard and perform a restore drill. Neither provider backups nor a restore have been verified by this repository review:

1. Restore a selected backup to an isolated database, not over the active database.
2. Point a temporary compatible app release to it with a separate token signing secret.
3. Check migration status and representative organization, request, event, reading, state, and quarantine records.
4. Record backup point, restore duration, and smoke-test result; remove the temporary database after validation.

Raw request bodies and coordinates are retained without automatic expiry. Set data retention before using real telemetry. See [Operations](OPERATIONS.md) and [Security](SECURITY.md).
