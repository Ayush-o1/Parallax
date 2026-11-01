# ADR-003 — Per-OEM Stale Vehicle Detection over Global Threshold

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

The original design had a single global `STALE_VEHICLE_THRESHOLD_SECONDS = 300`. This is problematic because the three OEM sources report at fundamentally different frequencies:

- OEM Alpha: every 30 seconds
- OEM Beta: every 60 seconds
- OEM Gamma: every 15 seconds

A 300-second global threshold would mean:
- Alpha would be declared stale only after 10 missed reports — too lenient.
- Gamma would tolerate 20 missed reports — absurdly lenient.
- Beta would tolerate 5 missed reports — roughly reasonable.

A tight threshold calibrated for Gamma would produce false stale alerts for Beta during normal operation.

## Decision

We use a **per-OEM stale threshold** computed as:

```
staleThreshold(source) = OEM_interval(source) × STALE_VEHICLE_FACTOR
```

With a default `STALE_VEHICLE_FACTOR` of 3:
- Alpha stale after: 30 × 3 = **90 seconds**
- Beta stale after: 60 × 3 = **180 seconds**
- Gamma stale after: 15 × 3 = **45 seconds**

The factor is configurable. The intervals are configurable per-OEM.

## Reasons

1. **Correctness.** A single threshold cannot be simultaneously appropriate for all sources.
2. **Flexibility.** The factor can be adjusted without changing code. A factor of 2 is tighter; 5 is more tolerant.
3. **Separation of concerns.** The stale-detection rule is centralised in `config.staleThresholdFor(source)` — services never compute this inline.

## Trade-offs

- More configuration to manage. Mitigated by sensible defaults.
- When a new OEM source is added, configure its expected interval. If unavailable, use the absolute fallback threshold (`STALE_VEHICLE_FALLBACK_SECONDS = 300`) without multiplying it by the factor; implementation should surface that the fallback was used.

## What staleness measures vs. what it does not

Stale detection uses `receivedAt` (last time we received a payload) not `eventTime` (when the vehicle generated the reading). This is intentional:

- `receivedAt` measures whether the OEM is still delivering data to us.
- `eventTime` measures when the vehicle last produced a reading.
- An OEM could replay old events with old `eventTime` values; `receivedAt` would still be recent, correctly indicating the channel is alive.

