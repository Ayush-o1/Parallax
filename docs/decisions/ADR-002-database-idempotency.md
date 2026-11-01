# ADR-002 — Database-Level Idempotency over Application-Level Only

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

Telemetry events may be submitted more than once. This can happen due to:
- OEM retry logic after a network timeout.
- Simulator replaying events to test the system.
- Downstream consumers re-delivering events (relevant in Phase 13 with Kafka).

We must ensure that processing the same event twice does not produce two normalized records or corrupt vehicle state.

## Decision

We enforce idempotency at **both** the database level (primary) and the application level (optimisation).

**Database:** A `UNIQUE` constraint on `(source, external_event_id)` in the `telemetry_readings` table. The database rejects duplicate inserts atomically, regardless of concurrent requests.

**Application:** We check for existence before inserting as an optimisation to return a `DUPLICATE` response without triggering a constraint violation exception in the happy path.

## Why Not Application-Level Only?

Consider two concurrent requests carrying the same event:

```
Request A                    Request B
  │                            │
  ├─ SELECT: not found          ├─ SELECT: not found
  │                            │
  ├─ INSERT ...                 ├─ INSERT ...  ← race: both insert
  │                            │
```

Both pass the application-level check simultaneously. Both attempt to insert. Without a database constraint, both succeed and we have a duplicate record. With a database constraint, one succeeds and one gets a constraint violation that we catch and translate to a `DUPLICATE` response.

## Trade-offs

- **Performance:** The unique index adds a small overhead to every insert. This is acceptable — correctness always beats micro-optimisation.
- **Error handling:** We must catch Prisma's `P2002` unique constraint error and translate it to an application-level `DUPLICATE` result rather than a 500.
- **Fingerprinting:** For events without a stable external ID, we generate a deterministic fingerprint from `(vin, source, eventTime)`. Documented in `docs/data-contracts.md`.
