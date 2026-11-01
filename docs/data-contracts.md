# Parallax — Data Contracts

**Version:** 0.1.0  
**Status:** Phase 1 — Approved  
**Last updated:** 2026-11-01

---

## 1. OEM Payload Schemas

Each OEM produces structurally distinct payloads. The differences are real-world OEM design choices — not arbitrary.

---

### 1.1 OEM Alpha

**Profile:** A traditional automotive OEM with flat JSON payloads and imperial units (mph, miles).  
**Reporting interval:** Every 30 seconds.  
**Event identifier:** Stable string, format `ALPHA-{number}`.

```json
{
  "vin":          "1HGBH41JXMN109186",
  "speed":        60,
  "speed_unit":   "mph",
  "odometer":     12500,
  "latitude":     12.9716,
  "longitude":    77.5946,
  "fuel_level":   74,
  "event_id":     "ALPHA-10001",
  "timestamp":    "2026-11-01T08:30:00Z"
}
```

**Field definitions:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `vin` | string | Yes | Vehicle Identification Number |
| `speed` | number | Yes | Vehicle speed in `speed_unit` |
| `speed_unit` | string | Yes | Must be `"mph"` |
| `odometer` | number | Yes | Cumulative distance in miles |
| `latitude` | number | Yes | WGS84 decimal degrees |
| `longitude` | number | Yes | WGS84 decimal degrees |
| `fuel_level` | number | Yes | Percentage 0–100 |
| `event_id` | string | Yes | Stable event identifier for idempotency |
| `timestamp` | string | Yes | ISO 8601 UTC |

---

### 1.2 OEM Beta

**Profile:** A newer OEM using metric units (km/h, km) with some redundancy in naming and an explicit distance unit field.  
**Reporting interval:** Every 60 seconds.  
**Event identifier:** Stable string, format `BETA-{number}`.

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
  "message_id":      "BETA-20001",
  "event_timestamp": "2026-11-01T08:30:05Z"
}
```

**Field definitions:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `vehicleId` | string | Yes | Acts as VIN |
| `vehicle_speed` | number | Yes | Speed in `unit` |
| `unit` | string | Yes | Must be `"km/h"` |
| `distance` | number | Yes | Cumulative distance in `distance_unit` |
| `distance_unit` | string | Yes | Must be `"km"` |
| `lat` | number | Yes | WGS84 latitude |
| `lng` | number | Yes | WGS84 longitude |
| `fuel_percent` | number | Yes | Percentage 0–100 |
| `message_id` | string | Yes | Stable event identifier |
| `event_timestamp` | string | Yes | ISO 8601 UTC |

---

### 1.3 OEM Gamma

**Profile:** A connected-vehicle platform aggregator using SI units (m/s) and a nested payload structure. Location and measurements are in sub-objects.  
**Reporting interval:** Every 15 seconds (highest frequency).  
**Event identifier:** Nested inside `vehicle.identifier`, format `GAMMA-{number}`.

```json
{
  "vehicle": {
    "vin":        "1HGBH41JXMN109188",
    "identifier": "GAMMA-30001"
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
| `vehicle.vin` | string | Yes | Vehicle Identification Number |
| `vehicle.identifier` | string | Yes | Stable event identifier |
| `measurements.velocity` | number | Yes | Speed in `measurements.velocity_unit` |
| `measurements.velocity_unit` | string | Yes | Must be `"m/s"` |
| `measurements.fuel` | number | Yes | Percentage 0–100. Gamma does not report odometer. |
| `position.latitude` | number | Yes | WGS84 latitude |
| `position.longitude` | number | Yes | WGS84 longitude |
| `generated_at` | string | Yes | ISO 8601 UTC |

> **Note:** OEM Gamma does not provide odometer data. The canonical `odometerKm` field will be `null` for all Gamma events. This is a documented limitation, not a normalization error.

---

## 2. Canonical Telemetry Schema

All accepted events are normalized to this structure before storage.

```json
{
  "source":           "OEM_ALPHA",
  "externalEventId":  "ALPHA-10001",
  "vin":              "1HGBH41JXMN109186",
  "eventTime":        "2026-11-01T08:30:00Z",
  "receivedAt":       "2026-11-01T08:30:01.345Z",
  "measurements": {
    "speedKph":     96.56,
    "odometerKm":   20116.8,
    "fuelPercent":  74,
    "latitude":     12.9716,
    "longitude":    77.5946
  }
}
```

### Canonical field definitions

| Field | Type | Nullable | Notes |
|-------|------|----------|-------|
| `source` | string | No | One of `OEM_ALPHA`, `OEM_BETA`, `OEM_GAMMA` |
| `externalEventId` | string | No | Original provider event ID |
| `vin` | string | No | Vehicle Identification Number |
| `eventTime` | ISO 8601 | No | When the OEM generated the reading |
| `receivedAt` | ISO 8601 | No | When Parallax received the payload |
| `measurements.speedKph` | decimal | No | Speed in km/h — always |
| `measurements.odometerKm` | decimal | Yes | Kilometres — null for Gamma |
| `measurements.fuelPercent` | integer | No | 0–100 |
| `measurements.latitude` | decimal | No | WGS84, ±90 |
| `measurements.longitude` | decimal | No | WGS84, ±180 |

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

All conversion factors are constants defined in `src/utils/unitConverter.js`. Magic numbers are never scattered through adapter code.

---

## 4. Timestamp Semantics

Two timestamps exist on every normalized event:

| Timestamp | Meaning | Source |
|-----------|---------|--------|
| `eventTime` | When the vehicle generated the reading | OEM payload |
| `receivedAt` | When Parallax received and accepted the HTTP request | System clock at ingestion time |

**Why keep both?**  
`eventTime` is used for vehicle state ordering — it determines whether a newly arrived event is newer than the stored state. `receivedAt` is used for operational monitoring — it tells us how much lag exists between event generation and backend receipt.

**Clock skew:**  
OEM device clocks may drift or be reset. We accept events up to 24 hours in the past (to handle delayed batches) and up to 5 minutes in the future (to handle minor clock skew). Events outside these bounds are quarantined with reason `TIMESTAMP_OUT_OF_RANGE`.

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
    "externalEventId": "ALPHA-10001"
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

| OEM | Identifier field | Constraint |
|-----|-----------------|------------|
| Alpha | `event_id` | `UNIQUE(source, externalEventId)` |
| Beta | `message_id` | `UNIQUE(source, externalEventId)` |
| Gamma | `vehicle.identifier` | `UNIQUE(source, externalEventId)` |

All three OEMs provide a stable event identifier. The constraint is enforced at the database level on the `telemetry_readings` table. Application-level pre-checks are an optimisation only.

---

## 7. Out-of-Order Event Rules

```
Event arrives with eventTime = T_new
Current vehicle state has lastEventTime = T_current

Case 1: T_new > T_current
  → Store telemetry reading
  → Update vehicle state

Case 2: T_new <= T_current
  → Store telemetry reading (historical record is preserved)
  → Skip vehicle state update

Case 3: T_new == T_current (exact tie)
  → Store telemetry reading
  → Skip vehicle state update (existing state is kept; last-write wins is avoided)
```

**Tie-breaking rationale:** When two events share the exact same event timestamp, we cannot determine which is "more current". Keeping the already-stored state is safer than replacing it with an equally-old value.

---

## 8. Quarantine Reasons

| Code | Condition |
|------|-----------|
| `MISSING_REQUIRED_FIELD` | A required field is absent |
| `UNKNOWN_VIN` | VIN is not registered in the system |
| `SPEED_OUT_OF_RANGE` | Speed is negative or > 400 km/h |
| `FUEL_OUT_OF_RANGE` | Fuel percent is < 0 or > 100 |
| `INVALID_COORDINATES` | Latitude outside ±90 or longitude outside ±180 |
| `UNSUPPORTED_UNIT` | Measurement unit is not in the known conversion table |
| `TIMESTAMP_OUT_OF_RANGE` | Event timestamp is > 24 h past or > 5 min future |
| `MALFORMED_PAYLOAD` | JSON structure does not match the expected OEM schema |
| `ODOMETER_REGRESSION` | Odometer value is lower than the stored historical maximum |
| `UNKNOWN_SOURCE` | No adapter is registered for the claimed source |
