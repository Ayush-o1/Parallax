# Parallax — Changelog

All notable changes to this project are documented here.

Format: `[version] — date`

---

## [0.3.0] — 2026-11-01

### Added
- Phase 2 Prisma schema and initial migration with separate request/event records, database-generated UUIDs, PostgreSQL-native data types, per-vehicle idempotency, deterministic derived-event keys, and CHECK constraints.
- Idempotent seed for the local `demo` organization, applied to the isolated development and test databases.
- Six PostgreSQL integration tests for persistence, constraints, concurrent duplicates, quarantine relationships, and transaction rollback.
- ADR-006 for durable ingestion lifecycle and transaction boundaries.

### Changed
- Refined organization ownership, concurrency-safe state upserts, and event-time-aware odometer regression handling.
- Documented request/event status lifecycle, unique constraints, and indexes.
- Added guarded Prisma command wrappers so test migrations and seeds select `parallax_test`; removed the unsafe forced-reset script.

---

## [0.2.0] — 2026-11-01

### Changed
- Completed the Phase 1 design review and clarified timestamp acceptance rules.
- Separated vehicle identity from OEM Gamma event identity.
- Made engine state and acceleration optional canonical measurements.
- Documented telemetry cadence limits for stale detection and hard-braking inference.
- Specified test database isolation, startup configuration validation, and request logging behavior.
- Added ADR-003 through ADR-005 for stale detection, quarantine relationships, and odometer regressions.
- Prepared Phase 2 for schema review before implementation.

---

## [0.1.0] — 2026-11-01

### Added
- Project foundation (Phase 0)
  - Express.js application with health endpoint
  - Centralized environment configuration (`src/config/env.js`)
  - Structured JSON logger (`src/utils/logger.js`)
  - Request logging middleware
  - Central error handling middleware
  - Graceful shutdown (SIGTERM / SIGINT)
  - Public placeholder frontend
  - 8 API tests with node:test + supertest

- Architecture and data contracts (Phase 1)
  - Functional and non-functional requirements
  - Architecture documentation with layer diagram and ingestion flow
  - OEM payload schemas (Alpha, Beta, Gamma)
  - Canonical telemetry schema with unit conversion rules
  - Timestamp semantics and quarantine reason codes
  - ADR-001: Modular monolith decision
  - ADR-002: Database-level idempotency decision
  - Project status tracking document
