# ADR-005 — Odometer Regression Handling

**Date:** 2026-11-01  
**Status:** Accepted  
**Author:** Parallax Team

---

## Context

A vehicle's odometer reading should be monotonically increasing. When an incoming `odometerKm` is lower than the vehicle's stored historical maximum, the system must decide what to do.

The naive options are:
- **Accept silently** — corrupts analytics.
- **Reject and discard** — loses the audit trail.
- **Reject and quarantine without storing the reading** — better, but still loses the historical context.

## Decision

We apply a **quarantine-and-flag** strategy that preserves both the quarantine record and the underlying telemetry reading:

### Step 1 — Quarantine
Insert a `quarantine_records` row with `reason = ODOMETER_REGRESSION`. This records that the anomaly was detected.

### Step 2 — Store the reading anyway, flagged
Insert the `telemetry_readings` row with `odometer_suspicious = true`. The reading remains in history so an operator can audit the full sequence of odometer values.

### Step 3 — Do not update vehicle state odometer
The vehicle state's `odometer_km` field is not updated when `odometer_suspicious = true`. The last-known valid odometer is preserved.

### Step 4 — Manual override path (Phase 9)
An operator with appropriate authorization may invoke a protected API to:
- Reset the odometer baseline for a vehicle.
- Mark specific suspicious readings as validated.
- All override actions are audit-logged.

Until that workflow is implemented, no regression is silently accepted as a new baseline. A legitimate correction or meter replacement must be reviewed and recorded as an explicit baseline adjustment, including reason, effective time, and operator identity; related readings stay flagged for audit.

## Regression threshold

| Delta | Interpretation | Action |
|-------|----------------|--------|
| Any regression | Cause is uncertain; it may be an older event, correction, replacement, or bad data | Flag as suspicious, quarantine, preserve reading, skip state update |
| > 5% regression | Prioritize for manual review; magnitude alone does not establish cause | Keep flagged and do not update state automatically |

The 5% value is an initial triage heuristic, not a universal physical rule. It does not establish whether a reading is legitimate. The alert helps operations prioritize review; lower regressions are still flagged because they may be out-of-order delivery or corrections.

## Why not reject entirely?

Rejecting and discarding a reading with an odometer regression would lose the raw telemetry data. An operator investigating a billing dispute or maintenance schedule error needs to see every reading the OEM sent — including the anomalous ones. The reading's existence in the database, combined with the `odometer_suspicious` flag and a corresponding quarantine record, provides a complete audit trail.

## Why accept regressions with `odometer_suspicious = true` rather than just quarantining?

Quarantine records contain the raw payload and rejection metadata. A telemetry reading contains the normalized, typed measurements. Both serve different purposes: quarantine for investigation, telemetry for analytics. By writing to both tables (with the suspicious flag), we preserve the ability to run queries like "show me all speed readings from vehicle X on date Y" even during an odometer anomaly investigation.

