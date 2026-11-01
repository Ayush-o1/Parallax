# ADR-002 — Database-Level, Vehicle-Scoped Event Idempotency

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

OEMs retry telemetry events after timeouts, and batch requests can be retried as a whole. Every receipt attempt must be preserved, while each normalized event must be stored at most once. Concurrent requests can race past an application-level existence check.

The current Alpha and Beta examples provide stable event identifiers per vehicle, but their contracts do not guarantee that an identifier is unique across all vehicles using a source. Gamma's sequence is explicitly per VIN.

## Decision

`IngestionRequest` records each HTTP attempt. It owns one or more `IngestionEvent` rows, one per extracted batch item. A duplicate attempt remains auditable with event status `DUPLICATE` but does not create another `TelemetryReading` or update vehicle state.

The database enforces:

```sql
UNIQUE (source, vehicle_id, external_event_id)
```

on normalized readings. This vehicle-scoped key matches the guaranteed identity scope in the current contracts. It can be widened only after a source contract establishes source-wide uniqueness.

`TelemetryReading.ingestion_event_id` is also unique so one ingestion attempt cannot produce multiple normalized readings.

Application pre-checks may improve response handling, but the PostgreSQL unique constraint is the concurrency-safe authority. A unique conflict aborts that event's processing transaction; the request and event receipt rows were committed earlier, and a follow-up transaction marks that attempt `DUPLICATE`.

## Why not application-level only?

Two requests may both read "not found" before either inserts. PostgreSQL arbitrates the unique-key conflict atomically, allowing one normalized row and converting the other attempt to a duplicate without corrupting state.

## Trade-offs

- The source and vehicle are part of every idempotency lookup and unique index.
- An OEM that legitimately reuses event IDs for the same vehicle would need an additional stable session/epoch field in the key; silently weakening idempotency is not acceptable.
- Quarantine and duplicate receipt attempts remain separate from canonical telemetry history.
