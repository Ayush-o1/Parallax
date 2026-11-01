# Parallax — Architecture

**Version:** 0.4.0

**Status:** Phases 0–15 implementation complete; runtime verification is tracked in `docs/PROJECT_STATUS.md`
**Last updated:** 2026-11-01

---

## 1. Architectural Style: Modular Monolith

Parallax starts as a **modular monolith** — a single deployable process with clearly separated internal modules.

**Why not microservices?**  
Microservices are a deployment and scaling strategy, not a code-quality strategy. They introduce network boundaries, distributed transactions, and operational complexity. For a project at this scale, all of that overhead would obscure the core engineering problems we are actually trying to solve: telemetry normalization, idempotency, event ordering, and state management. A well-structured monolith can be extracted into services later if a genuine scaling requirement emerges.

**Why modular?**  
Even inside a single process, poor separation of concerns creates maintenance problems. We enforce module boundaries through the folder structure and by following strict layer rules (described below). The result is code that is easy to test, easy to reason about, and easy to extract if needed.

---

## 2. Layer Responsibilities

```
HTTP Request
     │
     ▼
 ┌─────────────────────────────────────────────┐
 │  Middleware Layer                            │
 │  requestLogger · bodyParser · errorHandler  │
 └───────────────────────┬─────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────┐
 │  Route Layer                                │
 │  Defines URL surface, applies middleware    │
 └───────────────────────┬─────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────┐
 │  Controller Layer                           │
 │  HTTP concerns only: parse req, send res    │
 └───────────────────────┬─────────────────────┘
                         │
                         ▼
 ┌─────────────────────────────────────────────┐
 │  Service Layer                              │
 │  Business rules, orchestration              │
 └──────────┬──────────────────┬──────────────┘
            │                  │
            ▼                  ▼
 ┌──────────────────┐  ┌───────────────────────┐
 │  Adapter Layer   │  │  Repository Layer      │
 │  OEM translation │  │  DB access abstraction │
 └──────────────────┘  └───────────┬────────────┘
                                   │
                                   ▼
                       ┌───────────────────────┐
                       │  Prisma / PostgreSQL   │
                       └───────────────────────┘
```

### Layer rules (enforced by convention)

| Layer | May call | May NOT call |
|-------|----------|--------------|
| Route | Controller, Middleware | Service, Repository, Adapter |
| Controller | Service | Repository, Adapter directly |
| Service | Repository, Adapter, other Services | Controller |
| Adapter | Utility functions | Service, Repository |
| Repository | Prisma client | Service, Controller |

Breaking these rules creates coupling. If a controller queries the database directly, tests for that controller must set up a real database — slowing them down unnecessarily.

---

## 3. Telemetry Ingestion Data Flow

```text
HTTP request
  1. Persist IngestionRequest(status=RECEIVED, rawBody=BYTEA); commit first.
  2. Parse and extract events.
     - Malformed request: request-level quarantine; status=MALFORMED.
     - Valid request: create one PENDING IngestionEvent per event in the batch.
  3. Process each event in an independent transaction.
     - Invalid: write quarantine record and set event status=QUARANTINED.
     - Duplicate: set event status=DUPLICATE; do not write reading or state.
     - Accepted: write reading, conditionally upsert state, set event status.
  4. Derive the request's final status from its event outcomes.
```

Unexpected failures cannot erase the committed request body. Any event whose transaction did not commit remains pending and can be retried. Batch items have independent transactions, so one failure does not undo successful sibling outcomes.

## 4. Vehicle State Update Strategy

Use a conditional PostgreSQL UPSERT keyed by the unique `vehicle_id` in `vehicle_states`:

```sql
INSERT INTO vehicle_states (vehicle_id, latest_reading_id, last_event_time, trusted_odometer_km)
VALUES ($vehicle_id, $reading_id, $event_time, $initial_trusted_odometer)
ON CONFLICT (vehicle_id) DO UPDATE
SET latest_reading_id = EXCLUDED.latest_reading_id,
    last_event_time = EXCLUDED.last_event_time,
    trusted_odometer_km = CASE
      WHEN $odometer_suspicious OR $incoming_odometer IS NULL
        THEN vehicle_states.trusted_odometer_km
      ELSE $incoming_odometer
    END
WHERE vehicle_states.last_event_time < EXCLUDED.last_event_time;
```

A unique-key conflict makes concurrent writes target the same database row. PostgreSQL serializes those writes and evaluates the `WHERE` condition against the current row while holding its row lock. This avoids an application-level read-compare-write race. The reading insert, conditional UPSERT, and event status update share one transaction.

Late readings remain in history and cannot overwrite a newer state.

## 5. Idempotency Strategy

Telemetry event identifiers are unique within their vehicle and source for the current OEM contracts, but the contracts do not promise uniqueness across every vehicle using a source. Enforce `UNIQUE(source, vehicle_id, external_event_id)`. Widen the scope only if a source contract establishes source-wide uniqueness.

The database constraint is authoritative. An application pre-check may improve the response path but cannot prevent concurrent duplicate inserts. Every receipt attempt remains as an `IngestionEvent`; duplicate attempts receive `DUPLICATE` status but never create another normalized reading or update state.

Each derived event has a deterministic unique `dedupe_key` based on event type, vehicle, source, and stable per-vehicle external event ID at the trigger boundary. For example, `hard-braking:{vehicleId}:{source}:{externalEventId}`. Trip start/end use their crossing/ending event IDs, idling uses the first qualifying event in the idle episode, and staleness uses the current last-state event ID. These keys do not depend on random database UUIDs and remain stable across retries.

## 6. Module Map

```
src/
├── config/env.js           — All environment-driven config in one place
├── app.js                  — Express setup and middleware chain
├── server.js               — Port binding and graceful shutdown
│
├── routes/
│   ├── health.routes.js    — GET /health
│   ├── vehicle.routes.js   — Phase 3
│   ├── ingest.routes.js    — Phase 5
│   ├── telemetry.routes.js — Phase 7
│   └── event.routes.js     — Phase 8
│
├── controllers/
│   ├── health.controller.js
│   ├── vehicle.controller.js
│   ├── ingest.controller.js
│   ├── telemetry.controller.js
│   └── event.controller.js
│
├── services/
│   ├── ingestion.service.js     — Orchestrates the ingest pipeline
│   ├── vehicle.service.js       — Vehicle CRUD business logic
│   ├── telemetry.service.js     — Historical query logic
│   └── eventDetection.service.js — Derives operational events
│
├── adapters/
│   ├── index.js                 — Adapter registry (source → adapter)
│   ├── alpha.adapter.js         — OEM Alpha normalization
│   ├── beta.adapter.js          — OEM Beta normalization
│   └── gamma.adapter.js         — OEM Gamma normalization
│
├── repositories/
│   ├── vehicle.repository.js
│   ├── ingestionRequest.repository.js
│   ├── ingestionEvent.repository.js
│   ├── telemetry.repository.js
│   ├── vehicleState.repository.js
│   ├── derivedEvent.repository.js
│   └── quarantine.repository.js
│
├── middleware/
│   ├── requestLogger.js
│   └── errorHandler.js
│
└── utils/
    ├── logger.js
    ├── unitConverter.js         — Phase 4
    └── AppError.js              — Phase 3
```

---

## 7. Database Architecture

| Entity | Purpose | Key constraints |
|--------|---------|-----------------|
| `organizations` | Vehicle owner; seeded demo organization for local use | UUID PK; unique slug |
| `vehicles` | Registered vehicle with mandatory organization | UUID PK; FK organization; unique `(organization_id, vin)` |
| `ingestion_requests` | One organization-scoped HTTP request and its original body | UUID PK; FK organization; `BYTEA` body; optional parsed `JSONB`; string source and content-encoding metadata |
| `ingestion_events` | One extracted event and independent outcome | UUID PK; FK request; unique `(request_id, ordinal)` |
| `telemetry_readings` | Accepted normalized event and odometer flag | UUID PK; unique event FK; unique `(source, vehicle_id, external_event_id)` |
| `vehicle_states` | One latest state per vehicle and trusted odometer | UUID PK; unique vehicle; conditional UPSERT target |
| `derived_events` | Operational events with deterministic dedupe key | UUID PK; unique dedupe key |
| `quarantine_records` | Request- or event-level rejection record | Required request FK; nullable event and vehicle FKs |
| `api_clients` | Organization-scoped client credential used for bearer access tokens | UUID PK; unique client ID; revocable credential tied to one organization |
| `outbox_events` | Durable publication intent committed with telemetry/event changes | Unique deterministic key; claim lease; organization and vehicle scope |
| `kafka_inbox` | Idempotency ledger for each stream consumer group | Unique `(consumer_group, event_key)` and `(consumer_group, topic, partition, offset)` |

### Lifecycle and transaction boundaries

1. Persist an `IngestionRequest(status=RECEIVED)` with original bytes before parsing or event processing.
2. A parse failure produces request-level quarantine and `MALFORMED`; it does not require an `IngestionEvent`.
3. A valid request creates one pending event per extracted batch member and moves to `PROCESSING`.
4. Each event runs in its own transaction. Accepted work atomically writes the normalized reading, conditionally updates vehicle state, writes deterministic derived events, and changes event status. Invalid work atomically writes quarantine detail and sets `QUARANTINED`. A duplicate attempt is preserved as `DUPLICATE` without reading or state writes.
5. The request becomes `COMPLETED` when all events are accepted or duplicate, or `COMPLETED_WITH_ERRORS` if one or more events are quarantined or accepted with warnings. Unexpected failures leave uncommitted event work pending and the request body durable for retry.

Request and event status values are defined in ADR-006 and `docs/data-contracts.md` §13. The request commit is deliberately outside per-event transactions so downstream failure cannot lose the raw request. Independent batch transactions prevent one event from rolling back its siblings.

`quarantine_records.request_id` is required; `event_id` and `vehicle_id` are nullable. This supports malformed requests, unknown VINs, and unknown source identifiers. Store extracted `raw_vin` when available.

### Types and organization ownership

All primary and foreign identifiers use PostgreSQL UUID with database-side `gen_random_uuid()` defaults so raw SQL writes remain safe. The migration adds explicit PostgreSQL `CHECK` constraints for speed, fuel, location, odometer, non-empty stable event IDs, and non-negative batch ordinals. Original request bodies use `BYTEA`; parsed JSON uses nullable `JSONB`; normalized measurements use bounded `DECIMAL(p,s)`; event, receipt, and detection times use `TIMESTAMPTZ`. Source identifiers remain strings so unknown OEM values can be preserved.

Every vehicle and ingestion request has a required organization FK. Unauthenticated local development uses a seeded organization with slug `demo`. The request is attributed to that organization for quarantine and audit queries. Authentication must derive organization ownership from verified credentials; clients cannot choose an arbitrary organization ID.

## 8. Vehicle and organization ownership

`Vehicle.organization_id` is mandatory and every repository query is constrained by the organization resolved by middleware. Local development resolves the seeded `demo` tenant on the server. Production requests require verified bearer credentials; the organization comes from the credential's database record and signed token claims. Client-supplied organization IDs are never used to scope reads or writes. Each `ApiClient` belongs to exactly one organization and can be revoked.

## 9. Technology Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Language | JavaScript | Consistent with existing knowledge |
| Runtime | Node.js 24 | Installed version; LTS-equivalent line |
| Framework | Express.js | Minimal, explicit, widely used in industry |
| ORM | Prisma | Type-safe queries, migration management, known technology |
| Database | PostgreSQL | Relational integrity, JSONB for parsed payloads, byte-preserving raw request storage |
| Test runner | node:test | Built into Node 18+, zero extra dependency |
| HTTP test client | supertest | Standard for Express API testing |

---

## 10. Deferred Architecture Decisions

| Decision | Deferred until |
|----------|---------------|
| PostGIS for geospatial queries | If geofencing requirements emerge |
| OpenAPI / Swagger schema and interactive UI | If client integration needs exceed the maintained API guide and Postman collection |

## 11. Asynchronous jobs and streaming

When `REDIS_URL` is configured, HTTP ingestion commits the raw request and pending event rows, then queues the request ID. A BullMQ worker claims pending event rows, processes each in its own PostgreSQL transaction, retries with exponential backoff, and routes exhausted jobs to a dead-letter queue. On startup it re-enqueues durable requests left `RECEIVED` or `PROCESSING`. Without Redis configured, local development processes synchronously through the same service path.

Normalized telemetry and operational events create outbox rows in the same PostgreSQL transaction as readings, vehicle state, and event status. A separate Kafka publisher claims un-published rows with a PostgreSQL lease, sends to `telemetry.normalized.v1` or `operational.events.v1` keyed by vehicle UUID, then marks the row published. A crash after Kafka accepts a message but before the DB mark can resend it; consumers deduplicate using the stable outbox event key. Delivery is at least once. Kafka partitioning preserves per-vehicle order within one topic, while independent consumer groups each keep their own inbox record. Kafka being unavailable leaves outbox rows durable for retry and does not roll back accepted telemetry.

Prometheus metrics expose bounded-cardinality HTTP request counts/latencies, ingestion outcomes, BullMQ job results and queue wait time, outbox publication and pending counts, and per-consumer-group Kafka lag by topic partition. In production, `/metrics` is hidden unless the caller supplies the configured metrics bearer token.
| Docker Compose | Phase 2 (optional, PostgreSQL is local) |
