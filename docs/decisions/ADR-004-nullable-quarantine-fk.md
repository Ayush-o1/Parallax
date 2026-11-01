# ADR-004 — Nullable Vehicle FK on Quarantine Records

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

Quarantine records must preserve every invalid incoming payload for investigation. Three categories of invalid payload cannot be linked to a vehicle row:

1. **Unknown VIN** — the VIN is syntactically present in the payload but is not registered in the `vehicles` table.
2. **Missing VIN** — the payload is malformed; no VIN field is present or parseable.
3. **Unknown source** — no adapter exists for the claimed OEM source; we cannot even begin to extract a VIN.

If the quarantine table had a NOT NULL foreign key to `vehicles`, all three cases above would cause the quarantine write to fail with a referential integrity error — and the payload would be lost. This defeats the purpose of quarantine.

## Decision

The `vehicle_id` column on `quarantine_records` is **nullable**. A separate `raw_vin` column (type `TEXT`) stores whatever string the adapter was able to extract from the payload, even if no vehicle row exists.

Store the original request body in a byte-preserving `raw_body` field, including malformed JSON. A nullable `parsed_payload` JSONB field may accompany it when JSON parsing succeeds. JSONB alone cannot store invalid JSON or retain the exact input representation.

```sql
vehicle_id  INTEGER  REFERENCES vehicles(id)  ON DELETE SET NULL,  -- nullable
raw_vin     TEXT,                                                    -- raw extracted string
```

## Reasons

1. **Preservation is the primary requirement.** We must not lose a payload because it is invalid — that contradicts the definition of quarantine.
2. **Investigation.** An operator debugging a quarantine record needs to see what was received, even if we cannot link it to a registered vehicle.
3. **Reprocessing.** If a VIN is later registered, an operator can use `raw_vin` to identify quarantine records that belong to the newly registered vehicle and trigger reprocessing.

## Trade-offs

- Queries on quarantine records may need to `LEFT JOIN` vehicles rather than `INNER JOIN`. This is a minor query complexity cost.
- `raw_vin` may contain invalid or malicious strings. It is stored for audit only and is never used as a lookup key — `vehicle_id` is used for that purpose when available.

## Rejected alternative

Making `vehicle_id` NOT NULL and using a sentinel "unknown vehicle" row would work technically but is a hack — it pollutes the vehicles table with a fake record and makes every tenant-scoped query that filters by vehicle need to exclude the sentinel.

