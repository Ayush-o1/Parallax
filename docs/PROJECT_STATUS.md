# Parallax — Project Status

**Last updated:** 2026-11-01  
**Branch:** `main`  
**Current milestone:** End-to-end implementation and operational verification

## Delivered

| Phase | Scope | Status |
|---|---|---|
| 0–2 | Foundation, requirements, architecture, PostgreSQL/Prisma schema, migrations, demo seed | Complete |
| 3 | Tenant-scoped vehicle registration and query APIs | Complete |
| 4 | Alpha, Beta, and Gamma adapters and synthetic simulators | Complete |
| 5–6 | Durable request receipt, independent batch outcomes, quarantine, idempotency, conditional state UPSERT, event-time odometer handling | Complete |
| 7 | State, history, ingestion, quarantine, event, and summary APIs | Complete |
| 8 | Deterministic operational event detection and event history | Complete |
| 9 | Hashed API client credentials, bearer tokens, revocation, organization isolation | Complete |
| 10 | BullMQ queue, retries, dead-letter routing, recovery scan, worker shutdown | Complete; live retries, dead-letter routing, and worker processing verified |
| 11–12 | Responsive API-backed dashboard and organization-scoped Socket.IO updates | Complete; browser smoke verified against live synthetic vehicle data |
| 13 | Transactional outbox, Kafka-compatible topics, consumer groups, inbox idempotency | Complete; Redpanda publication and consumer inbox totals verified |
| 14 | Structured logs, request IDs, Prometheus metrics, security controls, benchmark harness | Complete; all three authenticated metrics endpoints and benchmark runs verified |
| 15 | Docker Compose, migrations/seed jobs, CI workflow, README, API/Postman docs | Complete; full local stack healthy and configuration validated |

## Database migrations

The following committed migrations are deployed to the separate local `parallax_dev` and `parallax_test` databases:

| Migration | Change |
|---|---|
| `20261101130000_init` | Organizations, vehicles, request/event ingestion lifecycle, normalized readings, vehicle state, quarantine, and derived events |
| `20261101150000_api_clients` | Organization-owned API clients for authentication |
| `20261101160000_outbox_streaming` | Transactional outbox and Kafka inbox idempotency |
| `20261101170000_ingestion_content_encoding` | Persist request content encoding for replayable raw-body recovery |

Database commands use the guarded Prisma wrapper and non-destructive `migrate deploy`. Test commands require `TEST_DATABASE_URL` to name `parallax_test`; they never fall back to `DATABASE_URL`.

## Verification

- `npm test`: 52 passing tests (8 PostgreSQL integration, 23 API, 21 unit).
- `npx prisma validate`: passing.
- `docker compose config --quiet`: passing.
- Package and Postman collection JSON parsing: passing.
- Live Compose health reports version 0.4.0; PostgreSQL, Redis, Redpanda, API, worker, and stream services run. Metrics endpoints return 200 with the configured token and remain hidden without it.
- Production API rejects unauthenticated requests; queue processing, retries, dead-letter routing, Kafka topics, and zero-lag consumer groups were verified.
- The dashboard browser smoke displayed the seeded demo fleet and current telemetry. The local production dashboard requires a demo API client; the temporary smoke client was revoked after verification.
- The [benchmark report](benchmarks/README.md) records 1,000-event and 10,000-event runs, including worker concurrency 8/16 comparison. Both 10,000-event runs completed with zero errors and verified persistence/publication/inbox totals.
- Final source syntax, configuration, production dependency audit, schema, and whitespace checks all passed before commit.

## Known constraints

- Local Compose uses a single Redpanda broker with replication factor one; it demonstrates Kafka-compatible delivery and recovery but not production broker redundancy.
- Local development mode can use the seeded `demo` organization without credentials. Production requires verified bearer credentials and resolves tenant ownership from the API-client record; clients cannot choose an arbitrary organization ID.
- Telemetry fixtures and simulators are synthetic; no OEM service or physical vehicle is contacted.

## Git

The implementation began from the existing `main` history and preserves it. Commits use the verified repository identity `Ayush-o1 <Ayushh.ofc10@gmail.com>`. No history rewrite is permitted.
