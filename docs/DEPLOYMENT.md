# Deployment guide

This guide targets a public synthetic-data demonstration. The repository has no provider credentials; no paid services have been provisioned. Use a managed PostgreSQL and Redis-compatible service. The included `render.yaml` is the recommended deployment path.

## Recommended topology and provider comparison

| Provider | Fit for this app | Cost shape and tradeoff |
|---|---|---|
| Render (recommended) | Blueprint provisions a Docker web service, a separate persistent worker, PostgreSQL, and Redis-compatible Key Value in one region. Same-origin Express serves both dashboard and API. WebSockets and custom HTTPS domains are supported. | The smallest always-on baseline is approximately $30/month at the current published small-plan prices: web $7, worker $7, Postgres $6, Key Value $10. Budget separately for storage, egress, workspace charges, and current plan changes. This is simple and predictable for a portfolio demo. |
| Railway | Persistent services support web and worker processes; GitHub/Docker deploys, PostgreSQL, Redis templates, private networking, and usage-based billing are available. | Hobby has a $5/month minimum that includes $5 usage credit; total depends on runtime, storage, and egress. It can be cheaper for a small demo, but the Redis/Postgres templates are services that the owner must configure for backups/HA; backups and restore rehearsal remain operator tasks. |

Render is recommended because this repo now includes a Render Blueprint with pre-deploy migrations, health check, same-origin web/API, worker, and managed data service references. Render documents inbound WebSockets for web services, private network URLs for Postgres/Key Value, and background workers that poll Redis-compatible queues. Railway is a reasonable alternative if usage-based billing and its project canvas are preferred; build separate web and worker services from the same Dockerfile and configure a pre-deploy migration command.

Pricing and capability research was checked against official provider documentation on 2026-11-01. Verify current prices and plan availability before provisioning:

- [Render pricing](https://render.com/pricing), [Render web services](https://render.com/docs/web-services), [Render background workers](https://render.com/docs/background-workers), [Render WebSockets](https://render.com/docs/websocket), [Render Key Value](https://render.com/docs/key-value), [Render Blueprint reference](https://render.com/docs/blueprint-spec).
- [Railway pricing](https://railway.com/pricing), [Railway services](https://docs.railway.com/services), [Railway databases](https://docs.railway.com/databases), [Railway Redis](https://docs.railway.com/databases/redis).

## Render Blueprint deployment

1. Review the estimate and create a Render account only if you choose to proceed. The Blueprint creates billable resources.
2. In Render, create a Blueprint from `Ayush-o1/Parallax`, branch `main`, file `render.yaml`, and review each service/database before confirming provisioning.
3. The Blueprint starts in Singapore to keep service-to-database/queue traffic in one region. It creates one web service, one background worker, paid persistent Key Value, and a small PostgreSQL database. `STREAMING_ENABLED=false` is deliberate; there is no production Kafka service in this topology.
4. Render generates `TOKEN_SIGNING_SECRET` and `METRICS_TOKEN`. Confirm both are present and at least 32 bytes. Keep generated values private. The WebSocket API uses the web service's same HTTPS origin and upgrades to `wss://` through the platform.
5. The web service's pre-deploy command runs `npm run db:migrate:prod` (`prisma migrate deploy`). Its initial-deploy hook seeds only the `demo` organization; it does not create an API credential or fabricate vehicles.
6. Wait until `/health/ready` reports database, Redis, and worker ready. Add a custom domain under the web service and follow the provider's DNS/TLS instructions. Render terminates HTTPS and supports custom domains.
7. Create a dashboard client in a secure one-off shell on the web service:

   ```sh
   npm run client:create -- demo "Parallax dashboard" VIEWER
   ```

   Save the client ID and secret in a password manager. The secret is displayed once. Use an `INGESTOR` client for simulator uploads and an `ADMIN` client only for trusted vehicle administration. Do not paste credentials into a ticket, source file, or dashboard URL.

8. To populate a presentation demo, run the synthetic simulator from a trusted machine using the ingestion client token and the HTTPS URL. Create the token via `/api/v1/auth/token`, set `PARALLAX_TOKEN` only in the current shell, and run `INGEST_URL=https://<domain>/api/v1/ingest npm run simulate`. All created readings are synthetic.
9. Confirm TLS/domain, dashboard login, API endpoints, WebSocket connection, worker heartbeat, and one accepted plus one quarantined synthetic event. Revoke test credentials after the demo if they are no longer needed.

Do not add Kafka broker variables unless a managed Kafka-compatible service is provisioned, authenticated, network-restricted, and monitored. When enabled, set `STREAMING_ENABLED=true`, `KAFKA_BROKERS`, partition/topic configuration, and the necessary broker credentials. A local single-node Redpanda Compose container is only a development fixture.

## Required production variables

The Render Blueprint links or generates its core variables. Configure the following in the provider's secret/settings interface; never store a production `.env` in Git:

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | yes | `production`; disables local demo authentication and dotenv loading. |
| `DATABASE_URL` | yes | Private PostgreSQL connection string. Must not name `parallax_dev` or `parallax_test`. Pool options are applied by the app; tune `DB_CONNECTION_LIMIT` if service count changes. |
| `REDIS_URL` | yes | Private Redis-compatible URL. Use persistent storage and `noeviction` for BullMQ. |
| `TOKEN_SIGNING_SECRET` | yes | Random secret at least 32 bytes; rotate by revoking clients/reissuing tokens and deploying a coordinated new key. |
| `METRICS_TOKEN` | yes | Independent random bearer token at least 32 bytes. `/metrics` is not public without it. |
| `STREAMING_ENABLED` | yes | `false` for the documented Render topology. Set true only after configuring Kafka. |
| `PORT` | platform | Render injects its service port. The app binds to `0.0.0.0`. |
| `TRUST_PROXY_HOPS` | yes on Render | `1`, for the provider proxy. Never blindly trust arbitrary forwarding headers. |
| `WORKER_CONCURRENCY` | yes | Start at `4` for the small web/worker plans; raise only with measured DB and queue capacity. |

Optional validated controls and OEM thresholds are listed in [`.env.example`](../.env.example). No API client secret is an environment variable: clients are stored as bcrypt hashes and the raw secret is shown once at creation.

## Docker alternative

For a private single-host demonstration, copy `.env.example` to ignored `.env`, set strong `POSTGRES_PASSWORD`, `TOKEN_SIGNING_SECRET`, and `METRICS_TOKEN` values (each token key at least 32 bytes), and run:

```sh
docker compose -f docker-compose.production.yml up --build -d
docker compose -f docker-compose.production.yml ps
curl -fsS http://localhost:3000/health/ready
```

This configuration has internal-only PostgreSQL and Redis, the production image, automatic migration/seed jobs, web readiness check, and worker heartbeat check. Only the HTTP web port is published. Put a TLS-terminating reverse proxy in front before exposing it publicly; configure `TRUST_PROXY_HOPS` to match the actual proxy chain. Protect the host and Docker socket. Do not publish database, Redis, or broker ports.

To stop without deleting data, use `docker compose -f docker-compose.production.yml down`. Do not use `down -v` unless intentionally destroying the demo database and queue.

## Release, rollback, and schema changes

1. Merge changes only after CI passes. Render is configured with checks-before-auto-deploy.
2. Pre-deploy runs committed Prisma migrations. Migrations must be additive/backward-compatible with the currently running release; deploy code that stops using old fields before dropping them in a later migration.
3. Verify `/health/ready`, sign-in, one read, one synthetic ingest, worker heartbeat, and browser console/network after deploy.
4. If application code fails, use the provider's previous-deploy rollback only when its schema remains compatible. Database migrations are not automatically rolled back. Restore a backup only into a separate database first, validate it, then point the service to the restored database during a planned recovery.
5. Record the deployed Git commit and migration state. Do not force-push or run `migrate dev`, `db push`, or reset commands against production.

## Backups and restore validation

Enable the provider's PostgreSQL backups/PITR before accepting data. Keep a backup outside the service's own volume/account where the provider supports it. Use this recovery drill at least before a public demo with meaningful data and regularly after:

1. Create an isolated temporary PostgreSQL database; do not restore over production.
2. Restore one selected backup into it using the provider's documented restore workflow.
3. Point a temporary app instance at that restored database with the same schema-compatible release and a separate signing secret.
4. Verify row counts and representative organization, raw request, telemetry, state, quarantine, and derived-event records; run `prisma migrate status` and read API history.
5. Record backup timestamp, point-in-time, duration, row checks, and app smoke results. Delete the temporary database only after recording the drill. This repository has not yet performed this external restore drill.

## Logs and troubleshooting

- `GET /health/live`: process is running.
- `GET /health/ready`: database, Redis, and worker heartbeat checks; HTTP 503 indicates an unavailable dependency.
- `GET /metrics`: Prometheus text metrics, requires `Authorization: Bearer <METRICS_TOKEN>` in production.
- Check logs for JSON `http request` entries and correlate by `X-Request-Id`; request bodies and credentials are not logged.
- Pending `RECEIVED`/`PROCESSING` rows should be re-enqueued when the worker starts. Inspect BullMQ failed jobs/dead-letter queue for exhausted retries.
- If readiness reports worker unavailable, inspect the background worker deployment and its Redis/Postgres connectivity before restarting the web service.
- If streaming is enabled, check PostgreSQL outbox pending count, broker availability, consumer group lag, and Kafka inbox; if disabled, outbox counts are intentionally not expected to grow.

For local performance tests, see [benchmark instructions](benchmarks/README.md). Reported local Docker throughput is not a hosted service-level guarantee.
