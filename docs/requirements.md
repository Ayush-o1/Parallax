# Parallax — Requirements

**Version:** 0.1.0  
**Status:** Phase 1 — Approved  
**Last updated:** 2026-11-01

---

## 1. Functional Requirements

### 1.1 Multi-OEM Telemetry Ingestion

| ID | Requirement |
|----|-------------|
| FR-01 | The system shall accept telemetry from three simulated OEM providers: Alpha, Beta, and Gamma. |
| FR-02 | Each provider's payload format shall be structurally different (field names, nesting, units). |
| FR-03 | The system shall identify the originating OEM from a provider identifier in the ingestion route or payload. |
| FR-04 | The system shall accept single-event and batch telemetry submissions. |
| FR-05 | The system shall reject payloads exceeding the configured maximum size. |

### 1.2 Data Normalization

| ID | Requirement |
|----|-------------|
| FR-06 | All accepted telemetry shall be converted to a canonical schema before persistence. |
| FR-07 | Speed shall always be stored in km/h regardless of source unit. |
| FR-08 | Odometer shall always be stored in kilometres regardless of source unit. |
| FR-09 | The original raw payload shall be preserved for audit and reprocessing. |
| FR-10 | Each normalization adapter shall be isolated — changes to one OEM adapter do not affect others. |

### 1.3 Data Validation

| ID | Requirement |
|----|-------------|
| FR-11 | The system shall validate required fields before normalization. |
| FR-12 | The system shall reject telemetry with latitude outside [-90, 90] or longitude outside [-180, 180]. |
| FR-13 | The system shall reject speed values below 0 or above 400 km/h. |
| FR-14 | The system shall reject fuel percentage outside [0, 100]. |
| FR-15 | The system shall reject events with timestamps more than 24 hours in the future. |
| FR-16 | Invalid events shall be quarantined with a reason; they shall not be silently discarded. |
| FR-17 | Missing optional fields shall not cause rejection of an otherwise valid event. |
| FR-18 | An unsupported measurement unit must not be guessed — the event is quarantined. |

### 1.4 Idempotency and Ordering

| ID | Requirement |
|----|-------------|
| FR-19 | The system shall detect and silently discard duplicate telemetry events using database-level uniqueness on (source, externalEventId). |
| FR-20 | Out-of-order events shall be stored in telemetry history but shall not overwrite a newer vehicle state. |
| FR-21 | Vehicle state updates shall compare event timestamps, not ingestion timestamps. |

### 1.5 Vehicle State Management

| ID | Requirement |
|----|-------------|
| FR-22 | The system shall maintain a latest-state record per vehicle (speed, location, fuel, odometer, last event time). |
| FR-23 | The latest state shall not require scanning the entire telemetry history table. |
| FR-24 | State updates shall be transactionally consistent with telemetry record creation. |

### 1.6 Derived Event Detection

| ID | Requirement |
|----|-------------|
| FR-25 | The system shall detect trip start events when a movement threshold is crossed. |
| FR-26 | The system shall detect trip end events when stationary duration exceeds a configured threshold. |
| FR-27 | The system shall detect excessive idling when a vehicle is stationary with engine on beyond a configured duration. |
| FR-28 | The system shall detect hard braking from sufficiently large negative speed delta. |
| FR-29 | The system shall detect vehicle reporting timeout when no telemetry arrives within the stale threshold. |
| FR-30 | Each derived event shall record type, vehicle, severity, event time, detection time, and a human-readable explanation. |

### 1.7 REST API

| ID | Requirement |
|----|-------------|
| FR-31 | The system shall expose REST endpoints for vehicle registration, listing, and details. |
| FR-32 | The system shall expose an ingestion endpoint per OEM source. |
| FR-33 | The system shall expose historical telemetry with time-range filtering and cursor pagination. |
| FR-34 | The system shall expose derived event history with filtering by type and severity. |
| FR-35 | The system shall expose a quarantine inspection endpoint. |
| FR-36 | All responses shall follow a consistent JSON envelope (`success`, `data`, `error`). |

### 1.8 Multi-Tenancy and Authentication (Phase 9)

| ID | Requirement |
|----|-------------|
| FR-37 | Organizations shall be isolated — one org cannot access another's vehicles or telemetry. |
| FR-38 | API clients shall authenticate using a client-credentials mechanism. |
| FR-39 | Raw secrets shall never be stored; only a secure hash is stored. |
| FR-40 | Credentials shall be revocable. |

### 1.9 Dashboard (Phase 11)

| ID | Requirement |
|----|-------------|
| FR-41 | The frontend shall display overview statistics sourced from the backend. |
| FR-42 | The frontend shall display vehicle list with current state. |
| FR-43 | The frontend shall display telemetry history, derived events, and quarantine records. |
| FR-44 | All values displayed shall come from real API calls — no hardcoded data. |

---

## 2. Non-Functional Requirements

### 2.1 Correctness

| ID | Requirement |
|----|-------------|
| NFR-01 | Duplicate events must never produce duplicate normalized records. |
| NFR-02 | Out-of-order events must never corrupt the latest vehicle state. |
| NFR-03 | State updates must be atomic — a partial write is worse than no write. |
| NFR-04 | Invalid events must be quarantined, not silently dropped. |

### 2.2 Reliability

| ID | Requirement |
|----|-------------|
| NFR-05 | Unhandled promise rejections shall be logged but shall not crash the server. |
| NFR-06 | The server shall respond to SIGTERM with a graceful shutdown. |
| NFR-07 | Background workers (Phase 10) shall handle crashes and retry safely. |

### 2.3 Maintainability

| ID | Requirement |
|----|-------------|
| NFR-08 | Each module shall have a single, clearly documented responsibility. |
| NFR-09 | Business logic shall live in services, not in controllers or routes. |
| NFR-10 | OEM-specific logic shall be confined to adapters. |
| NFR-11 | All schema changes shall be made through Prisma migrations — no manual DB edits. |

### 2.4 Security

| ID | Requirement |
|----|-------------|
| NFR-12 | No secrets shall be committed to the repository. |
| NFR-13 | Internal stack traces shall not be sent to clients in production. |
| NFR-14 | Tenant-scoped queries shall enforce isolation at the service/repository layer, not just the route. |

### 2.5 Observability

| ID | Requirement |
|----|-------------|
| NFR-15 | Every HTTP request shall produce a structured log line with method, path, status, and duration. |
| NFR-16 | Errors shall be logged with context before returning a sanitized response. |
| NFR-17 | Ingestion metrics (accepted / rejected / quarantined counts) shall be queryable via the dashboard API. |

### 2.6 Testability

| ID | Requirement |
|----|-------------|
| NFR-18 | Unit tests shall cover all adapters, validators, and event-detection rules. |
| NFR-19 | Integration tests shall verify database constraints, transactions, and idempotency. |
| NFR-20 | API tests shall cover success, validation failure, duplicate, and unauthorized scenarios. |
