# ADR-007 — Transactional outbox for Kafka publication

**Date:** 2026-11-01
**Status:** Accepted

## Context

Parallax needs to persist normalized telemetry and publish it to a Kafka-compatible stream. A direct PostgreSQL write followed by a Kafka write can lose messages if the process crashes between those operations. A Kafka write followed by a failed database transaction can publish data that was never accepted.

## Decision

When `STREAMING_ENABLED=true`, create an outbox row in the same PostgreSQL transaction that stores a normalized reading, advances vehicle state, records operational events, and updates ingestion status. A publisher leases pending rows, publishes them to the event-type topic with `vehicleId` as the Kafka key, and marks them published only after broker acknowledgement. When streaming is disabled, no outbox rows are created; PostgreSQL remains the durable source for readings and operational events.

Topics are `telemetry.normalized.v1` and `operational.events.v1`. Consumer groups are independent; each stores a `(consumer_group, event_key)` inbox record in the database before acknowledging its offset. Kafka producer delivery and consumer processing are at least once. Stable event keys make retries idempotent. Kafka unavailability leaves outbox rows pending and does not undo database acceptance.

## Consequences

- PostgreSQL is the system of record; the outbox closes the database-to-broker loss window.
- A broker acknowledgement followed by a publisher crash may produce a duplicate, handled by consumer idempotency.
- Partition keys preserve order for a given vehicle within a topic. Different topics do not promise cross-topic ordering.
- Consumer lag and pending outbox age are observable and replay is performed by republishing retained outbox rows or resetting a consumer group.
- Kafka is optional for a public demo. The recommended hosting topology deliberately sets `STREAMING_ENABLED=false` instead of treating a single-node development broker as production infrastructure.
