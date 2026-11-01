# Parallax — Project Status

**Last updated:** 2026-11-01  
**Current phase:** Phase 2 — Prisma schema foundation complete

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
**Commit:** `5419ea7` (design review completion: `010327b`)  
**Branch:** `main`
**Pushed:** Yes

**Delivered:**
- `docs/requirements.md` — 47 functional + 23 non-functional requirements, including Phase 2 persistence rules
- `docs/architecture.md` — layer diagram, ingestion flow, module map, technology decisions
- `docs/data-contracts.md` — 3 OEM payload schemas, canonical schema, unit conversion rules, timestamp semantics, quarantine reason codes
- `docs/decisions/ADR-001-modular-monolith.md`
- `docs/decisions/ADR-002-database-idempotency.md`
- `docs/decisions/ADR-003-stale-vehicle-detection.md`
- `docs/decisions/ADR-004-nullable-quarantine-fk.md`
- `docs/decisions/ADR-005-odometer-regression.md`
- Environment isolation and configuration tests

---

## Current Phase: Phase 2 — Database Design and Persistence Foundation

**Objective:** Implement the documented Prisma persistence foundation. The schema and idempotent seed are ready; no migration has been created or applied yet.

**Delivered:**
- `docs/decisions/ADR-006-ingestion-lifecycle-and-derived-event-idempotency.md`
- `prisma/schema.prisma` — UUID and PostgreSQL types, ingestion lifecycle, and idempotency constraints
- `prisma/seed.js` — idempotent `demo` organization seed

**Upcoming tasks:**
1. Review the Prisma schema and generated migration plan
2. Create and apply the initial migration against `parallax_dev`
3. Run the idempotent demo organization seed
4. Add integration tests against `parallax_test` for constraints, transactions, and concurrency

---

## Known Issues

- No migrations or PostgreSQL integration tests exist yet; the schema has only been validated with Prisma tooling.

---

## Database Changes

| Version | Change | Migration |
|---------|--------|-----------|
| Schema draft | Prisma schema created and validated; migration pending | — |

---

## Important Decisions

| Decision | ADR |
|----------|-----|
| Modular monolith over microservices | ADR-001 |
| Database-level idempotency | ADR-002 |
| Per-OEM stale detection | ADR-003 |
| Nullable vehicle relation for quarantine | ADR-004 |
| Quarantine and flag odometer regressions | ADR-005 |
| Durable request/event lifecycle and derived-event idempotency | ADR-006 |
| Durable request/event lifecycle and derived-event idempotency | ADR-006 |

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
