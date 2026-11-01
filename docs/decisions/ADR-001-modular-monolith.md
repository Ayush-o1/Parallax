# ADR-001 — Modular Monolith over Microservices

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

Parallax needs to process telemetry from multiple OEMs, normalize it, persist it, and derive operational events. Before writing any code, we must decide on the overall deployment architecture.

Two common choices for a backend platform like this are a **modular monolith** and **microservices**.

## Decision

We will build Parallax as a **modular monolith** — a single deployable Node.js process with strict internal module boundaries.

## Reasons

1. **Complexity budget.** The core engineering problems here are data normalization, idempotency, event ordering, and transactional consistency. Introducing service-to-service network calls, distributed tracing, and inter-service auth would add complexity without solving any of those problems.

2. **Database transactions.** A critical requirement is that writing the raw event, normalized telemetry, and updated vehicle state must be atomic. In a single process with a single database, this is one `BEGIN ... COMMIT`. Across microservices, it becomes a distributed transaction or an outbox pattern — significantly harder to implement correctly.

3. **Team size.** Microservices pay off when multiple teams can develop and deploy services independently. With one developer, the overhead of separate repos, CI pipelines, and inter-service contracts is pure cost with no benefit.

4. **Extractability.** A well-structured monolith with clear module boundaries can be decomposed into services later if a genuine scaling requirement emerges. A poorly-structured monolith cannot. We enforce the boundaries now so extraction remains an option.

## Trade-offs

| Concern | Monolith | Microservices |
|---------|----------|---------------|
| Operational simplicity | ✅ One process to run | ❌ Multiple services, network, service discovery |
| Atomic transactions | ✅ Simple | ❌ Requires distributed transaction patterns |
| Independent scaling | ❌ Scale whole app | ✅ Scale individual services |
| Fault isolation | ❌ One crash affects all | ✅ Isolated failures |
| Development speed (small team) | ✅ Fast | ❌ Coordination overhead |

For Parallax at MVP scale, the monolith wins on every dimension that matters.

## Future Consideration

If Parallax needed to scale the ingestion pipeline independently of the query API, the adapter + service layer design makes it natural to extract an `ingestion-service` that publishes to Kafka while a separate `query-service` reads from PostgreSQL. This is Phase 13.
