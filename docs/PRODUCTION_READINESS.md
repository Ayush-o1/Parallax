# Production readiness review

Review date: 2026-11-01. This review is based on the checked-in implementation and local verification, not a live cloud deployment.

## Findings and disposition

| Severity | Finding | Disposition |
|---|---|---|
| Critical | Production startup previously accepted incomplete configuration and development database names. | Fixed: production rejects missing/short signing and metrics secrets, missing Redis, invalid booleans/numbers, and `parallax_dev`/`parallax_test` URLs. Production requires `STREAMING_ENABLED` to be explicitly set to `true` or `false`. |
| Critical | Production container previously ran as a root-capable, single-stage image with dev packages. | Fixed: multi-stage Node 24 image, runtime dependency install, generated Prisma client copied from build, non-root `node` user, exec-form Node entrypoint. |
| High | API clients had tenant isolation but no operation roles. | Fixed: `VIEWER`, `INGESTOR`, and `ADMIN` authorization. Existing clients preserve prior access as `ADMIN`; newly created clients default to `VIEWER`. |
| High | Liveness was the only health endpoint; the web process could appear healthy with an unavailable database or queue. | Fixed: `/health/live` and `/health/ready`; readiness checks PostgreSQL, Redis, and the worker's expiring heartbeat. |
| High | The public dashboard retained its bearer token in `sessionStorage`. | Fixed: client credentials and token remain in page memory and are cleared on disconnect or reload. Use HTTPS in deployment. |
| High | A Kafka-disabled deployment would have accumulated undeliverable outbox rows. | Fixed: outbox writes and stale-event outbox publishing are conditional on `STREAMING_ENABLED`; Postgres remains authoritative. Render deployment explicitly disables streaming. |
| High | Database migrations were not wired to a hosted deploy. | Fixed: Render Blueprint runs `prisma migrate deploy` as a pre-deploy command; no production path uses `migrate dev`, `db push`, or reset. |
| Medium | Production settings were incompletely documented and mostly relied on implicit Prisma pool sizing. | Fixed: `.env.example` now inventories application settings; Prisma pool and timeout settings are validated and applied to application connections. |
| Medium | Browser behavior had no repeatable CI end-to-end check and ingestion lacked a receipt detail endpoint. | Fixed: Playwright journey covers overview, vehicle inspection, receipt payload, quarantine, events, and mobile width; tenant-scoped request detail endpoint added. |
| Medium | One local Redpanda node could be mistaken for redundant streaming infrastructure. | Fixed in deployment guidance: it is explicitly development-only; the recommended public demo leaves Kafka disabled. |
| Medium | No restore exercise had been performed. | Open operational action: backup restore is documented, but no external managed-database backup exists yet and no restore has been verified. Do not load real fleet data until a restore drill succeeds. |
| Medium | Multi-instance Socket.IO fanout and distributed rate-limit storage are not configured. | Open scale limitation: the recommended Blueprint starts one web instance. Before horizontal web scaling, add a Socket.IO shared adapter and shared rate-limit store, then test cross-instance delivery. |
| Low | Operational-event rules are intentionally source-limited and no alert routing is configured. | Documented: telemetry is synthetic; engine-on and acceleration signals are only emitted where the source provides them. Add external alerting only when a hosted operator needs it. |

## Verified security boundaries

- Client secrets are bcrypt hashes; one-time credential creation prints the secret only at the trusted CLI boundary.
- Access tokens use JOSE HS256 with explicit algorithm verification, expiry, and revocation checked against PostgreSQL on every REST and Socket.IO connection.
- Organization identity and role come from the active API-client database row. Request-supplied organization IDs do not select tenant data.
- `VIEWER` can inspect; `INGESTOR` can ingest and inspect; `ADMIN` can manage vehicles and ingest. Local demo bypass is disabled in production.
- Token exchange is separately rate-limited. API responses include request IDs; request logs omit credentials, bodies, and raw URLs.
- Helmet headers, a same-origin static/API deployment, request size limits, bounded pagination, input validation, and explicit HTTP timeouts are enabled.
- `/metrics` requires a separate constant-time bearer comparison in production. Health responses expose dependency state only, not credentials or database details.
- Socket.IO requires a bearer token in its handshake in production and joins only the database-resolved organization room. It accepts a short-lived bearer credential, not ambient cookies.

## Database and processing guarantees

PostgreSQL is the durable source of truth for original request bytes, event outcomes, normalized readings, latest state, quarantine, operational events, API clients, and (when enabled) the outbox. Each event transaction commits its own result. Database uniqueness constraints protect receipt-event identity, telemetry idempotency, derived-event deduplication, and Kafka inbox processing. The conditional vehicle-state UPSERT compares event time inside PostgreSQL under the conflicting row lock.

Redis/BullMQ is required in production for asynchronous ingestion and request recovery. Failed jobs retry with backoff and exhausted work is copied to a dead-letter queue. Request rows remain recoverable even if enqueueing fails. Redis is not the telemetry system of record.

When streaming is enabled, the PostgreSQL outbox and Kafka consumers provide at-least-once delivery with stable event keys and database inbox idempotency. Kafka and PostgreSQL do not share a transaction. The Render demo disables streaming and does not claim a Kafka service is available.

Raw requests have no automatic deletion policy. They remain stored until an explicit retention policy and migration are reviewed. Backups and retention affect sensitive location telemetry; set policy before accepting real data.

## Remaining gate before real production data

1. Provision the chosen provider and use its generated secrets; no cloud resources have been created from this workspace.
2. Configure and verify database backups, complete a restore into a separate database, and record recovery time and point-in-time.
3. Decide raw-payload and location-data retention, access audit, and deletion policy.
4. Keep one web instance until a shared Socket.IO adapter and distributed rate-limit store are implemented and verified.
5. Establish an alert recipient and review readiness, worker heartbeat, queue depth, failed jobs, and database capacity after deployment.

The system is prepared for a synthetic public demonstration, not represented as a certified automotive production service or a real OEM integration.
