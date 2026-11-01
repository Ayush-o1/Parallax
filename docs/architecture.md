# Parallax — Architecture

**Version:** 0.1.0  
**Status:** Phase 1 — Draft  
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

```
OEM Simulator
      │  POST /api/v1/ingest/:source
      ▼
 IngestionController
      │  extracts source identifier, raw body
      ▼
 IngestionService.ingest(source, rawPayload)
      │
      ├─ 1. Identify source → select adapter
      │
      ├─ 2. Validate raw payload against source rules
      │      └─ invalid → QuarantineRepository.save()
      │                    return { status: 'QUARANTINED' }
      │
      ├─ 3. Adapter.normalize(rawPayload)
      │      └─ produces CanonicalEvent
      │
      ├─ 4. Validate canonical values (ranges, types)
      │
      ├─ 5. Check idempotency
      │      └─ duplicate → return { status: 'DUPLICATE' }
      │         (database constraint as safety net)
      │
      ├─ 6. BEGIN TRANSACTION
      │      ├─ IngestionEventRepository.save(rawPayload, status='ACCEPTED')
      │      ├─ TelemetryRepository.save(canonicalEvent)
      │      └─ VehicleStateRepository.updateIfNewer(canonicalEvent)
      │         END TRANSACTION
      │
      └─ 7. (Phase 10) Enqueue background jobs for derived event detection
```

---

## 4. Vehicle State Update Strategy

A vehicle's "latest state" must be updated only when the incoming event is newer than the stored state.

```
Incoming event time: T_event
Stored state last_event_time: T_stored

IF T_event > T_stored:
    UPDATE vehicle state with new measurements
ELSE:
    Store telemetry history (do not skip it)
    Skip vehicle state update
```

This handles out-of-order delivery: a delayed event is stored in history but cannot overwrite a newer known state.

**Why use event time, not ingestion time?**  
The OEM generates the event at `eventTime`. The backend receives it at `receivedAt`. These differ because of network delay, batching, or retry. If we used `receivedAt` to decide which is newer, a retried old event could overwrite current state with stale data.

---

## 5. Idempotency Strategy

Some OEMs provide a stable `externalEventId` per telemetry reading. For these, we enforce a database-level unique constraint on `(source, externalEventId)`.

**Why database-level, not just application-level?**  
Application-level checks are vulnerable to a race condition: two concurrent requests both read "not a duplicate", both proceed to insert, and one fails with a constraint error. With a database unique constraint, the database enforces exclusivity atomically. The constraint violation is caught and translated to a `DUPLICATE` response.

For OEMs that do not supply a stable event identifier, we generate an application-level fingerprint from `(vin, source, eventTime)` and apply the same constraint.

---

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

Full schema is documented in `docs/database-design.md`. Core entities:

| Entity | Purpose |
|--------|---------|
| `vehicles` | Registered vehicles with VIN and OEM association |
| `ingestion_events` | Every raw payload received, with processing status |
| `telemetry_readings` | Normalized canonical measurements |
| `vehicle_states` | Latest known state per vehicle (one row per vehicle) |
| `derived_events` | Detected operational events (trips, idling, etc.) |
| `quarantine_records` | Invalid or rejected payloads with reasons |

---

## 8. Technology Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Language | JavaScript | Consistent with existing knowledge |
| Runtime | Node.js 24 | Installed version; LTS-equivalent line |
| Framework | Express.js | Minimal, explicit, widely used in industry |
| ORM | Prisma | Type-safe queries, migration management, known technology |
| Database | PostgreSQL | Relational integrity, JSONB for raw payloads, production-grade |
| Test runner | node:test | Built into Node 18+, zero extra dependency |
| HTTP test client | supertest | Standard for Express API testing |

---

## 9. Deferred Architecture Decisions

| Decision | Deferred until |
|----------|---------------|
| Redis / BullMQ for background processing | Phase 10 |
| Socket.IO for real-time updates | Phase 12 |
| Kafka for distributed event streaming | Phase 13 |
| PostGIS for geospatial queries | If geofencing requirements emerge |
| OpenAPI / Swagger documentation | Phase 15 |
| Docker Compose | Phase 2 (optional, PostgreSQL is local) |
