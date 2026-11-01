# Parallax — Project Status

**Last updated:** 2026-11-01  
**Current phase:** Phase 1 complete → Phase 2 starting

---

## Completed Phases

### ✅ Phase 0 — Project Foundation
**Commit:** `bde3e9e`  
**Branch:** `main`  
**Pushed:** Yes

**Implemented:**
- Node.js 24 + Express.js scaffold
- `src/config/env.js` — centralized config with dotenv and startup validation
- `src/utils/logger.js` — structured JSON logger (stdout/stderr)
- `src/middleware/requestLogger.js` — per-request structured logging
- `src/middleware/errorHandler.js` — central error handler, no stack leakage in production
- `src/controllers/health.controller.js` + `src/routes/health.routes.js`
- `src/app.js` — Express app factory (separate from server binding)
- `src/server.js` — port binding, graceful shutdown on SIGTERM/SIGINT
- `public/index.html` — placeholder frontend with API liveness check
- `.env.example`, `.gitignore`
- 8/8 API tests passing (node:test + supertest)

---

### ✅ Phase 1 — Requirements, Architecture, Data Contracts
**Commit:** (pending — next commit)  
**Branch:** `main`

**Delivered:**
- `docs/requirements.md` — 40 functional + 20 non-functional requirements
- `docs/architecture.md` — layer diagram, ingestion flow, module map, technology decisions
- `docs/data-contracts.md` — 3 OEM payload schemas, canonical schema, unit conversion rules, timestamp semantics, quarantine reason codes
- `docs/decisions/ADR-001-modular-monolith.md`
- `docs/decisions/ADR-002-database-idempotency.md`

---

## Current Phase: Phase 2 — Database Design and Persistence Foundation

**Objective:** Implement the initial PostgreSQL schema via Prisma.

**Upcoming tasks:**
1. Configure Prisma with `DATABASE_URL`
2. Design core entities: Vehicle, IngestionEvent, TelemetryReading, VehicleState, QuarantineRecord
3. Add relationships, foreign keys, unique constraints, indexes
4. Run migrations
5. Write seed data
6. Test constraints with integration tests

---

## Known Issues

- None at this stage.

---

## Database Changes

| Version | Change | Migration |
|---------|--------|-----------|
| (none yet) | — | — |

---

## Important Decisions

| Decision | ADR |
|----------|-----|
| Modular monolith over microservices | ADR-001 |
| Database-level idempotency | ADR-002 |

---

## Upcoming Work (by phase)

| Phase | Description |
|-------|-------------|
| 2 | Database schema + Prisma migrations |
| 3 | Vehicle management API |
| 4 | OEM simulators + adapter architecture |
| 5 | Telemetry ingestion pipeline |
| 6 | Idempotency + data consistency |
| 7 | Vehicle state + historical APIs |
| 8 | Derived event detection |
| 9 | Authentication + multi-tenancy |
| 10 | Background processing (Redis + BullMQ) |
| 11 | Frontend dashboard |
| 12 | Real-time updates (Socket.IO) |
| 13 | Kafka streaming |
| 14 | Observability + performance |
| 15 | Deployment + final docs |
