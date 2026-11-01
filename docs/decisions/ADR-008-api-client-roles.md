# ADR-008 — Tenant-scoped API client roles

**Date:** 2026-11-01
**Status:** Accepted

## Context

API clients were organization-scoped but all had identical write access. A hosted dashboard client should not need permission to register vehicles or submit telemetry. Organization isolation alone does not constrain what a valid client can change.

## Decision

Store one role on each `ApiClient`:

- `VIEWER`: tenant-scoped reads.
- `INGESTOR`: viewer reads and telemetry ingestion.
- `ADMIN`: ingestor access plus vehicle registration/update.

Middleware verifies the bearer token, reloads the active client row from PostgreSQL, and reads both organization and role from that row. The role claim is not trusted from request input or from unverified token content. Revocation and role changes apply immediately. New client-creation CLI calls default to `VIEWER`.

The migration gives already-existing clients `ADMIN` to preserve their prior permissions. Operators should review existing clients and downgrade credentials that do not need writes.

## Consequences

- A read-only dashboard can use a `VIEWER` credential.
- Simulator or OEM machine clients should use `INGESTOR`.
- `ADMIN` is required only for trusted vehicle management.
- This remains organization-wide authorization. Per-vehicle permissions, human identity, MFA, and granular actions are outside this synthetic MVP.
