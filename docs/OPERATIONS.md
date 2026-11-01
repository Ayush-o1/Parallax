# Operations guide

## Source of truth and service health

PostgreSQL is the durable source of truth for request bytes, event outcomes, normalized telemetry, vehicle state, quarantine, operational events, clients, and optional Kafka outbox/inbox records. Redis stores BullMQ queue/lock state and a 30-second worker heartbeat. It is replaceable queue infrastructure, not a telemetry archive. Kafka is optional and is disabled by the recommended Render configuration.

- `/health/live` reports process liveness.
- `/health/ready` executes a database check, Redis ping, and (in production) an expiring worker heartbeat check. A healthy web service with no worker is not ready.
- `/metrics` returns Prometheus metrics only with the production metrics bearer token.
- JSON request logs include `reqId`; the HTTP response exposes the same value as `X-Request-Id`.

## Normal deployment and migration procedure

1. Merge a CI-green commit; migrations must be reviewed for expand/contract compatibility.
2. Deploy the web service. `prisma migrate deploy` runs in Render pre-deploy, before new code receives traffic.
3. Deploy the worker from the same image and source commit.
4. Wait for `/health/ready`; verify status for database, Redis, and worker.
5. Confirm dashboard authentication, vehicle access, a synthetic ingestion, and no unexpected console/network errors.
6. Record Git SHA, migration state, and deployment time.

Do not run `prisma migrate dev`, `prisma db push`, or reset against production. A rollback of code does not roll back schema/data; use backward-compatible migration sequencing.

## Queue and ingestion recovery

Workers retry jobs five times with exponential delay. Exhausted requests are copied to the `parallax.ingestion.dead-letter` queue; failed jobs are retained within the configured BullMQ count while dead-letter jobs are retained for inspection. On worker start, durable `RECEIVED` and `PROCESSING` request rows are reconciled against BullMQ jobs and re-enqueued if needed. Individual event transactions leave already-committed siblings intact; retries only select pending event rows and database uniqueness prevents duplicate readings.

Troubleshoot a slow request by looking up its ingestion request ID in the authenticated dashboard/API, then correlate request logs by `X-Request-Id`. For stuck processing, check Redis connectivity, worker logs, queue failed state, dead letters, and request/event statuses. Do not replay a raw event by manually inserting telemetry rows.

## Streaming mode

The local `docker-compose.yml` Redpanda broker is a single-node development fixture. It is not HA. The recommended hosted demo sets `STREAMING_ENABLED=false`; derived events and normalized readings remain available from PostgreSQL and no outbox publication intent is created. To enable streaming, provision a managed Kafka-compatible service, credentials/TLS/network policy, and set `STREAMING_ENABLED=true` plus `KAFKA_BROKERS` and optional topics/partitions. Then deploy `scripts/streaming.js` as its own persistent process and expose metrics only on a protected/private path.

Outbox publishing is at least once because PostgreSQL and Kafka do not share a transaction. Stable keys plus inbox constraints make retries idempotent. Monitor unpublished outbox count/age, publisher errors, consumer lag, and inbox progress. Do not purge outbox/inbox rows without a replay/retention policy.

## Backups, restore, and retention

Enable managed PostgreSQL automated backups/PITR before keeping any meaningful demo state. Choose a backup window and retention period according to expected data loss tolerance. The repository has no automatic destructive retention job. Raw request bytes and coordinates may contain sensitive information; decide data retention before using real telemetry.

The restore verification procedure and explicit unverified status are in [DEPLOYMENT.md](DEPLOYMENT.md#backups-and-restore-validation). A backup is not considered usable until restored to a separate database, migration status checked, and representative tenant/request/reading/quarantine reads verified. Keep a written recovery time and point-in-time result.

## Capacity and profiling

The Prisma pool defaults to 10 connections per process with a 10-second pool wait and 5-second connect timeout. Set `DB_CONNECTION_LIMIT` based on the database's connection ceiling and total web/worker replicas. The starter Render topology uses one web and one worker with a small 100-connection database plan; do not multiply replicas without recalculating pools.

`WORKER_CONCURRENCY` defaults to 8 in local config and Render starts at 4. `MAX_BATCH_EVENTS` defaults to 500; request body bytes default to 64 KiB. Adjust these only after measuring memory, queue latency, PostgreSQL lock/pool wait, and throughput. Use [the reproducible benchmark](benchmarks/README.md) after any runtime/database change. Reported data is local Docker-only.

## Graceful shutdown and restart

The web Node process handles `SIGTERM`/`SIGINT`, stops accepting requests, closes Socket.IO, and disconnects Prisma. BullMQ worker `close()` waits for active jobs; its heartbeat is removed during shutdown. On restart, pending requests are recovered from PostgreSQL. Redis persistence is enabled in the production Compose alternative. A managed Redis service should use persistence for queue recovery; if Redis is lost, inspect durable pending requests and worker recovery before resuming traffic.

## Troubleshooting checklist

| Symptom | Check |
|---|---|
| Web returns 503 readiness | `DATABASE_URL`, Redis ping, worker heartbeat TTL, region/private network. |
| Ingestion stays processing | Worker logs, Redis queue/locks, failed jobs and dead-letter entries; confirm worker is on same DB/Redis. |
| Dashboard returns 401 | Reconnect with an active client; check expiry, revocation, client role, TLS, and request ID. |
| 403 on a write | Use an `INGESTOR` role for ingestion or `ADMIN` for vehicle registration/update. |
| Dashboard has no readings | Confirm correct tenant, seed demo org, API token, simulator request status, and event quarantine outcome. |
| Metrics returns 404 | In production this is intentional without a valid `METRICS_TOKEN`; verify secret and bearer header. |
| Kafka outbox grows | Confirm `STREAMING_ENABLED=true`, broker URL/network/TLS, publisher process, and consumer group health. If streaming is intentionally disabled, no new outbox rows should be created. |

## Cost and scale guardrails

The recommended hosting starter has one web process and one worker. It does not promise HA database, multi-region delivery, Kafka redundancy, or horizontal Socket.IO fanout. Keep the application single-region until workload measurements and scale-out coordination exist. Review provider costs monthly and remove unused preview/demo resources.
