# Parallax — Data Contracts

**Version:** 0.3.0

**Status:** Phase 2 — Schema Draft
**Last updated:** 2026-11-01

---

## 1. OEM Payload Schemas

Each OEM produces structurally distinct payloads. The differences reflect real-world OEM design choices, not arbitrary variation.

---

### 1.1 OEM Alpha

**Profile:** Traditional automotive OEM. Flat JSON payload, imperial units (mph, miles).  
**Reporting interval:** Every 30 seconds.  
**Engine-on signal:** Provided (`engine_on` boolean).  
**Longitudinal acceleration:** Not provided.

```json
{
  "vin":          "1HGBH41JXMN109186",
  "speed":        60,
  "speed_unit":   "mph",
  "odometer":     12500,
  "latitude":     12.9716,
  "longitude":    77.5946,
  "fuel_level":   74,
  "engine_on":    true,
  "event_id":     "ALPHA-EVT-10001",
  "timestamp":    "2026-11-01T08:30:00Z"
}
```

**Field definitions:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `vin` | string | Yes | Vehicle Identification Number — the persistent vehicle identity |
| `speed` | number | Yes | Vehicle speed in `speed_unit` |
| `speed_unit` | string | Yes | Must be `"mph"` |
| `odometer` | number | Yes | Cumulative distance in miles |
| `latitude` | number | Yes | WGS84 decimal degrees |
| `longitude` | number | Yes | WGS84 decimal degrees |
| `fuel_level` | number | Yes | Percentage 0–100 |
| `engine_on` | boolean | No | Optional engine running state; absent values normalize to `null` |
| `event_id` | string | Yes | **Telemetry-event identifier**, stable and unique per vehicle reading; no source-wide uniqueness guarantee |
| `timestamp` | string | Yes | ISO 8601 UTC — when the OEM generated this reading |

> **Note on `event_id` naming:** In OEM Alpha, `event_id` is a telemetry-event identifier — it changes with every reading. It is not a vehicle identifier. The vehicle is identified by `vin`. See §6 for the idempotency constraint built on this field.

---

### 1.2 OEM Beta

**Profile:** Newer OEM. Metric units (km/h, km), explicit distance-unit field, slightly redundant naming.  
**Reporting interval:** Every 60 seconds.  
**Engine-on signal:** Not provided — idling detection is unavailable for Beta vehicles.  
**Longitudinal acceleration:** Provided (`accel_mss`, m/s²).

```json
{
  "vehicleId":       "1HGBH41JXMN109187",
  "vehicle_speed":   96.56,
  "unit":            "km/h",
  "distance":        20116.8,
  "distance_unit":   "km",
  "lat":             12.9716,
  "lng":             77.5946,
  "fuel_percent":    62,
  "accel_mss":       -4.2,
  "message_id":      "BETA-EVT-20001",
  "event_timestamp": "2026-11-01T08:30:05Z"
}
```

**Field definitions:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `vehicleId` | string | Yes | Acts as VIN — the persistent vehicle identity |
| `vehicle_speed` | number | Yes | Speed in `unit` |
| `unit` | string | Yes | Must be `"km/h"` |
| `distance` | number | Yes | Cumulative distance in `distance_unit` |
| `distance_unit` | string | Yes | Must be `"km"` |
| `lat` | number | Yes | WGS84 latitude |
| `lng` | number | Yes | WGS84 longitude |
| `fuel_percent` | number | Yes | Percentage 0–100 |
| `accel_mss` | number | No | Longitudinal acceleration, m/s². Negative = deceleration |
| `message_id` | string | Yes | **Telemetry-event identifier**, stable and unique per vehicle reading; no source-wide uniqueness guarantee |
| `event_timestamp` | string | Yes | ISO 8601 UTC |

---

### 1.3 OEM Gamma

**Profile:** Connected-vehicle platform aggregator. SI units (m/s), nested payload structure. Highest reporting frequency.  
**Reporting interval:** Every 15 seconds.  
**Engine-on signal:** Not provided.  
**Longitudinal acceleration:** Not provided.

```json
{
  "vehicle": {
    "vin":        "1HGBH41JXMN109188",
    "seq":        30001
  },
  "measurements": {
    "velocity":      27.78,
    "velocity_unit": "m/s",
    "fuel":          58
  },
  "position": {
    "latitude":  12.9716,
    "longitude": 77.5946
  },
  "generated_at": "2026-11-01T08:30:10Z"
}
```

**Field definitions:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `vehicle.vin` | string | Yes | Vehicle Identification Number — the persistent vehicle identity |
| `vehicle.seq` | integer | Yes | **Per-vehicle monotonically increasing sequence number** — the telemetry-event identifier. Resets on vehicle replacement only. |
| `measurements.velocity` | number | Yes | Speed in `measurements.velocity_unit` |
| `measurements.velocity_unit` | string | Yes | Must be `"m/s"` |
| `measurements.fuel` | number | Yes | Percentage 0–100 |
| `position.latitude` | number | Yes | WGS84 latitude |
| `position.longitude` | number | Yes | WGS84 longitude |
| `generated_at` | string | Yes | ISO 8601 UTC |

> **Gamma identifier design — important distinction:**  
> The original design used `vehicle.identifier` (e.g. `"GAMMA-30001"`) for both identifying the vehicle and deduplicating the event. This is ambiguous — does the identifier change per reading, or per vehicle?  
>
> The corrected design separates these concerns explicitly:
> - **Vehicle identity:** `vehicle.vin` — stable across all readings.
> - **Event identity for idempotency:** `vehicle.seq` — an integer that increments per telemetry reading. The adapter constructs the canonical `externalEventId` as `GAMMA-{vin}-{seq}` so the vehicle scope is explicit in the value; database uniqueness remains vehicle-scoped.
>
> This mirrors the real-world pattern where telematics units maintain a sequence counter per ignition cycle or per connection session.

> **No odometer:** OEM Gamma does not report odometer. The canonical `odometerKm` will be `null` for all Gamma events — a documented source limitation.

---

## 2. Canonical Telemetry Schema

All accepted events are normalized to this structure before storage.

```json
{
  "source":           "OEM_ALPHA",
  "externalEventId":  "ALPHA-EVT-10001",
  "vin":              "1HGBH41JXMN109186",
  "eventTime":        "2026-11-01T08:30:00Z",
  "receivedAt":       "2026-11-01T08:30:01.345Z",
  "measurements": {
    "speedKph":          96.56,
    "odometerKm":        20116.8,
    "fuelPercent":       74,
    "latitude":          12.9716,
    "longitude":         77.5946,
    "engineOn":          true,
    "accelMss":          null
  }
}
```

### Canonical field definitions

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `source` | string | No | One of `OEM_ALPHA`, `OEM_BETA`, `OEM_GAMMA` |
| `externalEventId` | string | No | Provider telemetry-event ID — stable per vehicle and reading; DB uniqueness is `(source, vehicleId, externalEventId)` |
| `vin` | string | No | Vehicle Identification Number |
| `eventTime` | ISO 8601 | No | When the OEM generated this reading |
| `receivedAt` | ISO 8601 | No | When Parallax received and accepted the HTTP request |
| `measurements.speedKph` | decimal | No | Speed in km/h — always present |
| `measurements.odometerKm` | decimal | Yes | Kilometres — `null` for Gamma (source does not provide odometer) |
| `measurements.fuelPercent` | integer | No | 0–100 |
| `measurements.latitude` | decimal | No | WGS84, ±90 |
| `measurements.longitude` | decimal | No | WGS84, ±180 |
| `measurements.engineOn` | boolean | No | Optional engine running state. `null` when absent or not provided (Beta, Gamma) |
| `measurements.accelMss` | decimal | No | Optional longitudinal acceleration, m/s². `null` when absent or not provided (Alpha, Gamma) |

### Feature availability by OEM source

| Feature | OEM Alpha | OEM Beta | OEM Gamma |
|---------|-----------|----------|-----------|
| Speed (km/h) | ✅ (converted from mph) | ✅ | ✅ (converted from m/s) |
| Odometer (km) | ✅ (converted from miles) | ✅ | ❌ null |
| Fuel % | ✅ | ✅ | ✅ |
| Location | ✅ | ✅ | ✅ |
| Engine-on signal | ✅ | ❌ null | ❌ null |
| Longitudinal acceleration | ❌ null | ✅ | ❌ null |
| Idling detection possible | ✅ | ❌ | ❌ |
| Hard-braking signal available | ❌ | ✅ acceleration* | ❌ |

*OEM Beta supplies acceleration, but a hard-braking classification still requires a calibrated threshold, correct longitudinal-axis semantics, and adequate sampling. Alpha and Gamma do not provide acceleration; speed deltas across their documented 30 s and 15 s intervals are too sparse to claim reliable hard-braking detection. Do not emit a hard-braking event from those sources unless a denser, validated sample stream is available. Any enabled proxy must state its sampling interval and limitations.

---

## 3. Unit Conversion Rules

| OEM | Source unit | Conversion | Target unit |
|-----|-------------|------------|-------------|
| Alpha | mph | × 1.60934 | km/h |
| Beta | km/h | × 1 (passthrough) | km/h |
| Gamma | m/s | × 3.6 | km/h |
| Alpha | miles (odometer) | × 1.60934 | km |
| Beta | km (odometer) | × 1 (passthrough) | km |
| Gamma | — (no odometer) | — | null |
| Beta | m/s² (acceleration) | × 1 (passthrough) | m/s² |

All conversion factors are constants defined in `src/utils/unitConverter.js`. They are never scattered through adapter code.

---

## 4. Timestamp Semantics

Two timestamps exist on every normalized event:

| Timestamp | Meaning | Source |
|-----------|---------|--------|
| `eventTime` | When the vehicle generated the reading | OEM payload |
| `receivedAt` | When Parallax received and accepted the HTTP request | System clock at ingestion time |

**Why keep both?**  
`eventTime` is used for vehicle state ordering — it determines whether a newly arrived event is newer than the stored state. `receivedAt` is used for operational monitoring — it tells us how much lag exists between event generation and backend receipt, and for stale-vehicle detection.

### Timestamp acceptance window

An event must include a parseable OEM timestamp. Missing or malformed timestamps are quarantined (`MISSING_EVENT_TIME` or `INVALID_EVENT_TIME`); Parallax does not substitute receipt time because that would invent when the vehicle generated the reading. A valid past timestamp is accepted, including delayed delivery, if it is within the configured past bound. A timestamp up to the future bound is accepted as tolerated clock skew and its original value is preserved. Events outside either bound are quarantined with `TIMESTAMP_OUT_OF_RANGE`.

| Bound | Default | Config key | Reason |
|-------|---------|-----------|--------|
| Past | 24 hours (86400 s) | `MAX_EVENT_AGE_PAST_SECONDS` | Allows OEM batch uploads and retry delivery |
| Future | 5 minutes (300 s) | `MAX_EVENT_AGE_FUTURE_SECONDS` | Accommodates minor OEM device clock skew |

The bounds use `eventTime` relative to server receipt time. `receivedAt` is always assigned by Parallax. A future timestamp within tolerance can temporarily be ahead of server time; consumers must retain both timestamps and must not treat this tolerated skew as proof of a later real-world event.

---

## 5. Ingestion Response Format

### Accepted

```json
{
  "success": true,
  "data": {
    "status": "ACCEPTED",
    "telemetryId": "clx1a2b3c4d5e6f7g8h9i0j1k",
    "vin": "1HGBH41JXMN109186",
    "eventTime": "2026-11-01T08:30:00Z"
  }
}
```

### Duplicate

```json
{
  "success": true,
  "data": {
    "status": "DUPLICATE",
    "externalEventId": "ALPHA-EVT-10001"
  }
}
```

> Duplicate returns HTTP 200, not an error. The event was previously accepted; this is expected behaviour.

### Quarantined

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Event quarantined",
    "reason": "SPEED_OUT_OF_RANGE",
    "detail": "speedKph 9500 exceeds maximum of 400"
  }
}
```

Returns HTTP 422.

### Unknown source

```json
{
  "success": false,
  "error": {
    "code": "UNKNOWN_SOURCE",
    "message": "No adapter registered for source: OEM_DELTA"
  }
}
```

Returns HTTP 400.

---

## 6. Idempotency Rules

Each OEM event identifier is stable for a vehicle's reading, but the contracts do not guarantee uniqueness across all vehicles reporting to the same source. The database therefore scopes identity to the vehicle:

```sql
UNIQUE (source, vehicle_id, external_event_id)
```

Alpha `event_id` and Beta `message_id` must be stable per vehicle; Gamma's sequence is per VIN and is canonicalized as `GAMMA-{vin}-{seq}`. The source identifier remains a string. Unknown source values are preserved on requests and quarantine records.

Every HTTP receipt becomes an `IngestionRequest`; each extracted item becomes its own `IngestionEvent`, even when the item is a duplicate. A duplicate event status is committed without a second normalized reading or vehicle-state update. See ADR-002 for why the database unique constraint is authoritative.

## 7. Event Ordering and Odometer Regression

Every valid, nonduplicate event with a registered vehicle is stored as a normalized reading, including late historical events. Vehicle state changes only when `eventTime` is newer than the current state's event time; the comparison is enforced in a conditional PostgreSQL UPSERT, not an application read-compare-write.

Odometer regression is evaluated only for an event newer than the current state. A late event is not compared blindly with the latest odometer because its lower reading may be historically correct. For a newer event, an odometer below the trusted current value is suspicious: preserve the normalized reading with `odometerSuspicious=true`, add an `ODOMETER_REGRESSION` quarantine record, and update the latest state for other valid measurements while leaving the trusted odometer unchanged. If no baseline exists, accept the first reading as the baseline unless it fails ordinary validation.

A legitimate correction or meter replacement requires an explicit, audited baseline adjustment with operator, reason, and effective time. The 5% magnitude is a review-priority heuristic only; it does not identify the cause.

## 8. Stale Vehicle Detection Strategy

Different OEMs report at different frequencies. A single global stale threshold would produce false alerts for slow OEMs and miss real outages for fast OEMs.

**Per-source stale threshold:**

```
staleThreshold(source) = OEM_interval(source) × STALE_VEHICLE_FACTOR
```

| OEM | Expected interval | Factor | Stale after |
|-----|-----------------|--------|-------------|
| Alpha | 30 s | 3 | 90 s |
| Beta | 60 s | 3 | 180 s |
| Gamma | 15 s | 3 | 45 s |

The factor (default 3) is configurable. It prevents transient connectivity glitches or a single missed report from triggering a stale alert.

**Detection mechanism:**  
A background worker (Phase 10) checks the most recent accepted telemetry `receivedAt` per vehicle against its per-source threshold. The `(vehicle_id, received_at DESC)` index supports this query. State measurement fields still advance only for newer event times.

**Why `receivedAt` not `eventTime` for staleness?**  
Staleness measures whether the backend is still receiving data, not whether the vehicle's last event was recent. An OEM could replay a batch of old events; `receivedAt` would update but `eventTime` might still be old. We use `receivedAt` (when we last saw a heartbeat from the OEM) and `eventTime` for state ordering — they serve different purposes.

---

## 9. Derived Event Detection — Source Sufficiency

### 9.1 Trip detection
- **Requires:** `speedKph` — available from all three OEMs.
- **Rule:** Speed exceeds `TRIP_START_SPEED_KPH` → trip start. Speed stays below threshold for `TRIP_END_STATIONARY_SECONDS` → trip end.
- **Reliability:** High for Alpha and Gamma (15–30 s intervals). Lower for Beta (60 s intervals) — a short trip could be missed entirely if it begins and ends within one reporting interval.

### 9.2 Excessive idling
- **Requires:** `engineOn = true` AND `speedKph < TRIP_START_SPEED_KPH` for `IDLING_THRESHOLD_SECONDS`.
- **Alpha:** ✅ `engineOn` is provided — idling detection is reliable.
- **Beta:** ❌ `engineOn` is `null` — idling detection is **not performed** for Beta vehicles. The system will not emit a false positive; it will record the absence in the event explanation.
- **Gamma:** ❌ `engineOn` is `null` — same as Beta.

### 9.3 Hard braking
- **Beta:** `accelMss` is available, but classification requires a calibrated threshold, validated axis/sign semantics, and adequate sample frequency. Availability alone does not make the classification reliable.
- **Alpha / Gamma:** No acceleration is provided. Their documented 30 s / 15 s intervals are too sparse for reliable hard-braking inference from speed deltas. Do not emit hard-braking events from these sources unless a denser, validated stream is introduced.
- Every enabled detector must include method, sample interval, and limitations in the derived event explanation.

### 9.4 Vehicle reporting timeout
- **Requires:** `receivedAt` from the last accepted event.
- **Available for:** all sources.
- **Rule:** Per-source stale threshold (§8).

### 9.5 Event explanation field
Every derived event stores a human-readable `explanation` string, e.g.:
- `"Hard braking detected via speed-delta: −35 km/h in 30 s (accelerometer not available from OEM Alpha)"`
- `"Idling detection skipped: OEM Beta does not provide engine-on signal"`

This transparency prevents confusing a missing feature for a bug.

---

## 10. Quarantine Data Model

`IngestionRequest` preserves the complete raw HTTP body and request-level status. `IngestionEvent` represents one extracted item and its individual outcome. Quarantine records require the request foreign key, but both the event and vehicle foreign keys are nullable:

- Malformed request: `eventId=null`, `vehicleId=null`; preserve the request bytes and reason at request level.
- Invalid extracted event: link `eventId`; `vehicleId` is null when VIN is unknown or no vehicle is registered.
- Suspicious newer odometer: link both the event and known vehicle, while retaining the normalized reading for other usable measurements.

Store the original body as `BYTEA`; store successfully parsed request/event JSON in nullable `JSONB` fields. JSONB alone cannot preserve malformed JSON or the exact body. `source` is a string so unrecognized identifiers survive quarantine.

## 11. Quarantine Reasons

| Code | Condition |
|------|-----------|
| `MISSING_REQUIRED_FIELD` | A required field is absent or null |
| `UNKNOWN_VIN` | VIN is syntactically valid but not registered in the system |
| `SPEED_OUT_OF_RANGE` | speedKph < 0 or > 400 |
| `FUEL_OUT_OF_RANGE` | fuelPercent < 0 or > 100 |
| `INVALID_COORDINATES` | latitude outside ±90 or longitude outside ±180 |
| `UNSUPPORTED_UNIT` | Measurement unit not in the known conversion table |
| `MISSING_EVENT_TIME` | OEM timestamp field is absent or null |
| `INVALID_EVENT_TIME` | OEM timestamp is present but cannot be parsed |
| `TIMESTAMP_OUT_OF_RANGE` | eventTime exceeds the configured past or future bound |
| `MALFORMED_PAYLOAD` | JSON structure does not match the expected OEM schema |
| `ODOMETER_REGRESSION` | Newer event's odometer is below the trusted state baseline — see §12 |
| `MALFORMED_REQUEST` | Request body cannot be parsed into events |
| `UNKNOWN_SOURCE` | No adapter registered for this source identifier |

---

## 12. Odometer Regression Policy

Compare odometers in event-time order. A valid late historical reading is stored without comparing it to the current latest odometer. This avoids labeling normal historical values as regressions.

For a reading newer than vehicle state, if its odometer is below the trusted odometer baseline, store the normalized reading with `odometerSuspicious=true`, create an `ODOMETER_REGRESSION` quarantine record, and do not replace the trusted odometer. The event can still advance the latest-reading pointer and update its other valid measurements, such as speed, location, fuel, and event time.

The first valid reading establishes a baseline if none exists. A legitimate correction or meter replacement requires an explicit, audit-logged baseline adjustment with reason, effective time, and operator identity; the MVP does not infer or apply resets automatically. A 5% difference may prioritize review but does not classify the cause.

## 13. Database Persistence Design

This design is documented before Prisma models are created. Primary and foreign keys are PostgreSQL UUIDs with database-side `gen_random_uuid()` defaults. The initial migration adds database `CHECK` constraints for canonical ranges so Prisma and raw SQL paths enforce the same rules. All timestamps use `TIMESTAMPTZ(6)`, measurements use bounded `DECIMAL(p,s)`, request bodies use `BYTEA`, and successfully parsed payloads use `JSONB`. Incoming `source` values use strings rather than a closed enum.

### Entities and relationships

| Entity | Relationship and purpose |
|--------|--------------------------|
| `Organization` | Owns many vehicles. A seeded organization with slug `demo` serves local unauthenticated development. |
| `Vehicle` | Requires an organization; has VIN and source identifier. |
| `IngestionRequest` | One organization-scoped HTTP receipt and original body; has zero or many extracted events and quarantine records. |
| `IngestionEvent` | One item extracted from a request; has an ordinal, source identity, optional event ID/VIN, processing status, and optional parsed event payload. |
| `TelemetryReading` | One normalized accepted event; belongs to one ingestion event and one registered vehicle. |
| `VehicleState` | At most one row per vehicle; references the latest accepted reading and stores the trusted odometer baseline. |
| `QuarantineRecord` | Belongs to a request; may reference an event and a vehicle. This supports whole-request parse failure and unknown VINs. |
| `DerivedEvent` | Belongs to a vehicle; may reference the reading that triggered it and always has an idempotency key. |

All vehicles and ingestion requests require an organization from the first migration. The demo organization is seeded for local use; unauthenticated ingestion is attributed to it. When authentication is introduced, organization ownership must come from verified credentials; a client-supplied organization ID is never trusted for authorization or tenant selection.

### Lifecycle states

`IngestionRequest.status`: `RECEIVED`, `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, `MALFORMED`.

`IngestionEvent.status`: `PENDING`, `ACCEPTED`, `ACCEPTED_WITH_WARNINGS`, `QUARANTINED`, `DUPLICATE`.

Persist the request as `RECEIVED` before parsing. If parsing fails, create a request-level quarantine record and set `MALFORMED`. Otherwise create one pending event per extracted payload and process every event independently. A process crash before an event transaction commits leaves it pending; the durable request body remains available for retry. Set the request to `COMPLETED` when every item is accepted or duplicate, and `COMPLETED_WITH_ERRORS` when any item is quarantined or accepted with warnings. A request with an unexpected transient failure remains `PROCESSING` until retry completes.

### Unique constraints and indexes

- `Organization.slug` unique.
- `Vehicle(organization_id, vin)` unique; index `(source, vin)` for registration/adapter resolution.
- `IngestionRequest.organization_id` required; indexes `(organization_id, status, received_at)` and `(organization_id, source, received_at DESC)` support tenant-scoped inspection.
- `IngestionEvent(request_id, ordinal)` unique; indexes `(status, created_at)` and `(source, raw_vin, external_event_id)` for processing and duplicate triage.
- `TelemetryReading(ingestion_event_id)` unique, enforcing at most one normalized reading per event attempt.
- `TelemetryReading(source, vehicle_id, external_event_id)` unique. This is vehicle-scoped because the OEM contracts do not guarantee source-wide uniqueness.
- `TelemetryReading(vehicle_id, event_time DESC)` and `(vehicle_id, received_at DESC)` indexed for history and receipt-lag queries.
- `VehicleState.vehicle_id` unique; `VehicleState.latest_reading_id` unique. The vehicle key is the conditional UPSERT conflict target.
- `QuarantineRecord(request_id)`, `(event_id)`, `(vehicle_id)`, and `(reason, created_at)` indexed for audit and inspection.
- `DerivedEvent.dedupe_key` unique; `(vehicle_id, occurred_at DESC)` and `(event_type, occurred_at DESC)` indexed for event history.

### Per-event transactions

- **Accepted:** In one transaction, insert the normalized reading; compare event time and conditionally UPSERT vehicle state; insert deterministic derived events; set event status `ACCEPTED`; commit.
- **Suspicious newer odometer:** In one transaction, insert the normalized reading with `odometer_suspicious=true`; insert quarantine detail; conditionally update latest state and non-odometer measurements while preserving `trusted_odometer_km`; set `ACCEPTED_WITH_WARNINGS`; commit.
- **Invalid:** In one transaction, insert event-linked quarantine information and set event status `QUARANTINED`; commit.
- **Duplicate:** Preserve the `IngestionEvent` receipt attempt and set `DUPLICATE`; do not insert another reading or update state. The unique constraint determines the race-safe outcome.

The raw request commit is outside these event transactions, so no event failure can roll back the original body. One batch item's transaction cannot roll back another item's outcome.

### Atomic state UPSERT

Use `INSERT ... ON CONFLICT (vehicle_id) DO UPDATE ... WHERE vehicle_states.last_event_time < EXCLUDED.last_event_time`. PostgreSQL locks the conflicting unique-key row and evaluates this condition against the current row. Concurrent events therefore serialize at the row and only the newer timestamp can advance state; application-level read-compare-write is not relied on. For a suspicious odometer, the update preserves the existing trusted odometer while advancing the latest reading pointer and event time.

### Derived-event idempotency keys

Construct `dedupe_key` from event type, vehicle UUID, source, and stable per-vehicle `external_event_id`, rather than a random database reading UUID. Example keys:

- `hard-braking:{vehicleId}:{source}:{externalEventId}`
- `trip-start:{vehicleId}:{source}:{crossingExternalEventId}`
- `trip-end:{vehicleId}:{source}:{endingExternalEventId}`
- `idling:{vehicleId}:{source}:{idleEpisodeStartExternalEventId}`
- `stale:{vehicleId}:{source}:{lastStateExternalEventId}`

The unique key makes a repeated detector execution a no-op for the same triggering event. A new transition has a different stable trigger ID and can create a new derived event.
