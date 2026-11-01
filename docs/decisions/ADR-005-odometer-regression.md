# ADR-005 — Event-Time-Aware Odometer Regression Handling

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

A lower odometer can be a valid older reading delivered late, an actual data error, or a legitimate correction/meter replacement. Comparing every incoming value to the latest state incorrectly labels out-of-order history as a regression.

## Decision

First compare event time with the vehicle's latest state:

1. If the event is older or equal, store the valid nonduplicate reading as historical data. Do not compare its odometer against the current trusted odometer and do not update state.
2. If it is newer, compare its odometer to the trusted state baseline. If lower, persist the normalized reading with `odometer_suspicious=true`, create an `ODOMETER_REGRESSION` quarantine record, and mark the event `ACCEPTED_WITH_WARNINGS`.
3. The newer suspicious reading can advance the latest-reading pointer and update its other valid measurements. It must not replace `trusted_odometer_km`.
4. If no trusted baseline exists, the first valid odometer establishes it. Missing odometers do not erase a known trusted value.

The reading, quarantine record, conditional state update, derived events, and event status are atomic in one event transaction. An explicit baseline correction or meter replacement requires an audit record with operator identity, reason, and effective time. The MVP does not infer resets automatically. A 5% delta may prioritize investigation but is not a classification rule.

## Consequences

- Historical late-arriving readings remain useful and do not create false anomaly alerts.
- A suspicious odometer does not make valid speed, location, fuel, or timestamp measurements unusable.
- Vehicle state needs separate trusted-odometer storage because its latest reading can carry an untrusted odometer value.
