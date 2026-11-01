# Parallax HTTP API

Base URL: `http://localhost:3000` in local development. The complete Postman collection is in `postman/Parallax.postman_collection.json`.

## Authentication and tenancy

`POST /api/v1/auth/token` accepts JSON:

```json
{
  "grant_type": "client_credentials",
  "client_id": "px-…",
  "client_secret": "…"
}
```

On success it returns `data.access_token`, `data.token_type=Bearer`, and `data.expires_in`. Send `Authorization: Bearer <token>` to protected routes. Production requires a valid token on every request. The organization is loaded from the active API client row and compared to the signed claim; client-supplied tenant IDs are ignored. Revocation takes effect on the next API request. Local development without a bearer token resolves the `demo` organization server-side.

## Common response shapes

Successful resource response:

```json
{ "success": true, "data": { "id": "…" } }
```

Paged response:

```json
{ "success": true, "data": [], "page": { "limit": 25, "hasMore": false, "nextCursor": null } }
```

Error response:

```json
{ "success": false, "error": { "code": "INVALID_VIN", "message": "vin must be 17 valid VIN characters." } }
```

## Vehicle routes

| Method and path | Behavior |
|---|---|
| `POST /api/v1/vehicles` | Body `{ "vin": "1HGBH41JXMN109186", "source": "OEM_ALPHA" }`; returns `201`. VIN is trimmed and uppercased. Valid sources are `OEM_ALPHA`, `OEM_BETA`, and `OEM_GAMMA`. |
| `GET /api/v1/vehicles?limit=25&cursor=<uuid>&search=<vin>&source=<source>` | Tenant-scoped page; limit 1–100. Cursor points to the last returned vehicle. |
| `GET /api/v1/vehicles/:vehicleId` | Returns the vehicle and latest state if available. Unknown or other-tenant IDs return `404`. |
| `PATCH /api/v1/vehicles/:vehicleId` | Body `{ "source": "OEM_BETA" }`. Other fields are rejected. |

Unique `(organization_id, vin)` is enforced by PostgreSQL. A duplicate VIN returns `409 RESOURCE_CONFLICT`.

## Telemetry ingestion

`POST /api/v1/ingest/:source` accepts a single event object, an array of event objects, or an object with an `events` array. The path source is retained as a string even when unknown. The route captures the request bytes first and stores them in `ingestion_requests.raw_body`; optional gzip, deflate, and Brotli content encodings are decoded only after this durable write.

Example:

```sh
curl http://localhost:3000/api/v1/ingest/OEM_ALPHA \
  -H 'content-type: application/json' \
  -d '{"vin":"1HGBH41JXMN109186","speed":60,"speed_unit":"mph","odometer":12500,"latitude":12.9716,"longitude":77.5946,"fuel_level":74,"engine_on":true,"event_id":"ALPHA-EVT-10001","timestamp":"2026-11-01T08:30:00Z"}'
```

Each extracted event gets its own `PENDING` row and transaction. A normal synchronous request returns HTTP `200`; an event with quarantine or warning returns `207`; malformed JSON/encoding returns `400` after request-level quarantine is stored. With `REDIS_URL` configured, a successfully prepared request returns `202` while BullMQ processes the events.

Example mixed outcome:

```json
{
  "success": true,
  "data": {
    "requestId": "…",
    "status": "COMPLETED_WITH_ERRORS",
    "eventResults": [
      { "ingestionEventId": "…", "status": "ACCEPTED" },
      { "ingestionEventId": "…", "status": "QUARANTINED" }
    ]
  }
}
```

Supported event outcomes are `ACCEPTED`, `ACCEPTED_WITH_WARNINGS`, `QUARANTINED`, and `DUPLICATE`. Duplicates preserve the receipt attempt but produce no new telemetry row or state update. Request lifecycle values are `RECEIVED`, `PROCESSING`, `COMPLETED`, `COMPLETED_WITH_ERRORS`, and `MALFORMED`.

## Query routes

| Method and path | Behavior |
|---|---|
| `GET /api/v1/summary` | Live tenant counts: registered, active/stale, ingestion statuses, quarantine count, and source distribution. |
| `GET /api/v1/ingestions?limit=50&cursor=<uuid>&status=PROCESSING` | Tenant-scoped request lifecycle and child counts. |
| `GET /api/v1/quarantine?limit=50&cursor=<uuid>&reason=UNKNOWN_VIN` | Request/event rejection detail, parsed event payload if available, original UTF-8 request text and exact raw body Base64. |
| `GET /api/v1/vehicles/:vehicleId/state` | Latest event-time reading and trusted odometer. Returns `data: null` before the first accepted reading. |
| `GET /api/v1/vehicles/:vehicleId/telemetry?from=<ISO>&to=<ISO>&limit=50&cursor=<uuid>` | Event-time descending historical page. From/to are inclusive. |
| `GET /api/v1/vehicles/:vehicleId/events?limit=50&cursor=<uuid>` | Derived operational event page. |

All routes verify vehicle ownership before reading state/history. Limits are 1–100, and cursor IDs are UUIDs.

## Operational endpoints

- `GET /health` returns liveness status and process uptime.
- `GET /metrics` on the API returns HTTP metrics. Compose exposes the worker metrics at `:9465/metrics` (BullMQ processing outcomes and queue delay) and stream metrics at `:9466/metrics` (outbox publication and Kafka consumer lag). Every production metrics endpoint requires the configured bearer `METRICS_TOKEN`; otherwise it returns `404`.
- Socket.IO authenticates with handshake `{ "auth": { "token": "…" } }` in production and joins only the server-resolved organization room.
