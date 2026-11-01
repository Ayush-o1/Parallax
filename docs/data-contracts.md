# Parallax — Data Contracts

**Version:** 0.2.0  
**Status:** Phase 1 — Design Review  
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
| `event_id` | string | Yes | **Telemetry-event identifier** (unique per reading, not per vehicle) |
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
| `message_id` | string | Yes | **Telemetry-event identifier** (unique per reading) |
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
> - **Event identity for idempotency:** `vehicle.seq` — an integer that increments per telemetry reading. The adapter constructs the canonical `externalEventId` as `GAMMA-{vin}-{seq}` to ensure global uniqueness.
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
| `externalEventId` | string | No | Provider telemetry-event ID — unique per reading, not per vehicle |
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

The `externalEventId` in the canonical schema is the telemetry-event identifier — it uniquely identifies a single reading, not the vehicle.

| OEM | Source field | Canonical `externalEventId` |
|-----|-------------|---------------------------|
| Alpha | `event_id` | value as-is (e.g. `ALPHA-EVT-10001`) |
| Beta | `message_id` | value as-is (e.g. `BETA-EVT-20001`) |
| Gamma | `vehicle.seq` | constructed: `GAMMA-{vin}-{seq}` (e.g. `GAMMA-1HGBH41JXMN109188-30001`) |

The uniqueness constraint is enforced at the database level on the `telemetry_readings` table:

```
UNIQUE(source, external_event_id)
```

Application-level pre-checks are an optimisation only and do not replace the database constraint. See ADR-002.

---

## 7. Out-of-Order Event Rules

```
Event arrives with eventTime = T_new
Current vehicle state has last_event_time = T_stored

Case 1: T_new > T_stored  →  Store reading + update vehicle state
Case 2: T_new < T_stored  →  Store reading (history preserved) + skip state update
Case 3: T_new == T_stored →  Store reading + skip state update (keep existing state)
```

**Tie-breaking rationale:** When two events share the exact same `eventTime`, we cannot determine which measurement is "more current". Keeping the already-stored state avoids a last-write-wins race.

---

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
A background worker (Phase 10) periodically queries `vehicle_states` for vehicles where `last_received_at < NOW() - staleThreshold(source)`. The stale threshold is computed per vehicle using the OEM source recorded at registration.

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

Quarantine records must be stored **without** requiring a valid vehicle foreign key. Reasons:

1. A payload with an unknown VIN cannot be linked to a vehicle row.
2. A malformed payload may not even contain a parseable VIN.
3. Both cases must still be preserved for investigation.

The `quarantine_records` table uses:
- `vehicle_id` — nullable foreign key (null when VIN is unknown or missing).
- `raw_vin` — the raw string value extracted from the payload (or null if not parseable). Stored for audit even when no vehicle row exists.
- `source` — always stored (identifies which OEM sent the payload).
- `raw_body` — bytes (or lossless text) — the original HTTP request body, including malformed JSON.
- `parsed_payload` — nullable JSONB — parsed representation when the body is valid JSON; not a replacement for `raw_body`.
- `quarantine_reason` — enum code from §11.
- `detail` — human-readable explanation of the specific failure.
- `received_at` — when the payload arrived.

---

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
| `ODOMETER_REGRESSION` | Odometer is lower than the stored historical maximum — see §12 |
| `UNKNOWN_SOURCE` | No adapter registered for this source identifier |

---

## 12. Odometer Regression Policy

An odometer reading that is lower than the vehicle's recorded historical maximum is suspicious. It could indicate:

1. **Data corruption** in the OEM device or transmission.
2. **Out-of-order delivery** of a genuinely older event.
3. **Legitimate odometer correction** after a component replacement.
4. **Vehicle sale or fleet transfer** where the odometer was reset.

### Handling strategy

| Scenario | Action |
|----------|--------|
| Any regression | Quarantine with `ODOMETER_REGRESSION`. Store the telemetry reading but mark `odometer_suspicious = true`. Do not update vehicle state odometer. |
| Regression > 5% of max | Use 5% as a triage heuristic for manual review, not as proof of cause. Do not update state automatically. |
| Legitimate correction or meter replacement | Require an explicit, audit-logged baseline adjustment with reason, effective time, and operator identity. The protected operator workflow is planned for Phase 9; until implemented, no regression silently becomes a new baseline. |

**Why not silently accept regressions?**  
An odometer that moves backward corrupts any distance-based analytics (fuel efficiency, maintenance scheduling, mileage billing). Silent acceptance would cause silent data quality degradation. Quarantining and flagging makes the anomaly visible.

**Why still store the reading?**  
The historical record preserves what the OEM reported. An operator investigating a data quality issue needs to see all readings, including suspicious ones, not just the clean ones.
