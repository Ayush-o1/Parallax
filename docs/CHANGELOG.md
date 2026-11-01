# Parallax — Changelog

All notable changes to this project are documented here.

Format: `[version] — date`

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
