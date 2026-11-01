# ADR-006 — Durable Request Ingestion and Idempotent Event Processing

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

An HTTP request may contain a batch of telemetry events. The request body must survive malformed JSON and unexpected processing failures, while each extracted event needs an independent outcome. Retries must not duplicate readings, state changes, or derived operational events.

## Decision

### Request and event records

- `IngestionRequest` represents one HTTP receipt, stores its original request bytes before parsing, and requires an organization owner.
- Unauthenticated local requests are attributed to the seeded `demo` organization; authenticated requests will resolve organization from verified credentials.
- `IngestionEvent` represents one extracted event with an ordinal and independent processing status.
- A malformed body is quarantined at request level without requiring an event row.

Request statuses are `RECEIVED`, `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, and `MALFORMED`. Event statuses are `PENDING`, `ACCEPTED`, `ACCEPTED_WITH_WARNINGS`, `QUARANTINED`, and `DUPLICATE`. An unexpected failure leaves committed request bytes intact and uncommitted work pending for retry.

### Transaction boundaries

Persist the request first and commit. For valid batches, create pending event rows. Each event then processes in its own transaction:

- Accepted: normalized reading, conditional vehicle-state UPSERT, deterministic derived events, and event status commit together.
- Invalid: quarantine details and event status commit together.
- Suspicious newer odometer: flagged normalized reading, quarantine detail, state update that preserves the trusted odometer, and warning status commit together.
- Duplicate: persist the attempt status, but do not create another normalized reading or update state.

Independent event transactions prevent one bad batch member from rolling back its siblings. The initial request commit is outside all event transactions so failures cannot lose the original body.

### Atomic vehicle-state update

Use a PostgreSQL `INSERT ... ON CONFLICT (vehicle_id) DO UPDATE ... WHERE current.last_event_time < EXCLUDED.last_event_time`. The unique conflict serializes concurrent writes on the vehicle-state row; PostgreSQL evaluates the condition against the current locked row. No application-level read-compare-write is used.

### Derived-event deduplication

Each derived event has a unique deterministic `dedupe_key` built from event type, vehicle ID, source, and stable per-vehicle external event ID for the trigger boundary. This remains stable across retries even if a database-generated reading UUID changes. Examples are defined in `docs/data-contracts.md` §13.

## Consequences

- Request payloads and duplicate attempts are auditable independently of canonical readings.
- Batch members can succeed, quarantine, or duplicate independently.
- A process crash cannot erase the raw request; pending work can be retried.
- Unique keys and a conditional UPSERT provide database-level concurrency guarantees.
