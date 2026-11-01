# Security model

## Trust boundaries

- OEM payloads are untrusted and may be malformed, oversized, compressed, or unknown-source. The route captures wire bytes before JSON parsing, enforces the byte limit, and stores request receipts before event work.
- `organizationId` is never trusted from a request body, query, route, or websocket room. Bearer claims are verified, then the API-client row supplies its active organization and role.
- All source and telemetry values are synthetic. No production OEM credential or vehicle hardware integration exists.

## Authentication and authorization

API clients authenticate with `client_credentials`. Secrets are generated with a cryptographic random source, hashed with bcrypt, and emitted only once by `scripts/api-client.js`. JOSE signs short-lived HS256 access tokens; verification pins `HS256`, validates expiry, and loads the current client row so revocation and role changes take effect immediately. Signing keys are required in production, at least 32 bytes, and must be kept in a secret manager.

Roles are intentionally small:

| Role | Allowed operations |
|---|---|
| `VIEWER` | Tenant-scoped GET APIs and dashboard inspection. |
| `INGESTOR` | Viewer operations plus telemetry ingestion. |
| `ADMIN` | Ingestor operations plus vehicle registration and update. |

The role is read from PostgreSQL on each authenticated request; it is not trusted from a client or token field. The migration preserves existing API clients as `ADMIN` to avoid silently breaking deployed clients. New clients default to `VIEWER`; choose a narrower role explicitly.

REST requests and Socket.IO handshakes both require a valid bearer token in production. The client sends the Socket.IO token in the `auth` handshake object, not a URL query. The socket joins only the organization room resolved from its active client row. Local demo bypass applies only outside production. The dashboard stores no credential/token in `localStorage` or `sessionStorage`; reload requires reconnecting.

## HTTP and data protections

- Helmet sets security headers; Express JSON and ingestion requests are bounded; batch ingestion defaults to 500 events; pagination is capped at 100; server request/header timeouts are explicit.
- API and token routes have rate limits and structured JSON 429 responses. They use IPs after a configured, bounded proxy hop count. Current rate-limit counters are process-local; keep one web replica until a shared rate-limit store is installed.
- The UI and API are served same-origin. CORS is not opened to arbitrary websites. Custom domain deployments must remain HTTPS.
- Errors return stable public messages and request IDs. Production logs omit stacks, bearer/client secrets, body data, and raw URL segments. Raw telemetry itself is retained in `BYTEA` for audit/quarantine and should be treated as sensitive location data.
- `/metrics` uses a separate bearer token; health checks return dependency labels but no connection strings or secrets.
- Prisma parameterizes normal data access. The few raw SQL queries use Prisma tagged-template parameters; latest state uses an atomic conditional UPSERT.

## Production secret and environment checklist

- `NODE_ENV=production`.
- Strong random `TOKEN_SIGNING_SECRET` and independent `METRICS_TOKEN`, both at least 32 bytes.
- Managed private `DATABASE_URL`; production rejects known development/test DB names.
- Persistent `REDIS_URL` with a no-eviction policy for BullMQ.
- `STREAMING_ENABLED=false` unless a managed, authenticated Kafka-compatible broker has been deliberately provisioned.
- `TRUST_PROXY_HOPS` matches only the known provider proxy topology.
- Secrets stay in the hosting provider's secret settings. `.env`, `.env.*`, and local secrets are ignored.

## Data retention and incident response

There is intentionally no automatic request, reading, quarantine, event, outbox, or inbox cleanup. Define retention and deletion semantics before using real data, including backup retention and subject/deletion requirements. Do not log raw payloads while triaging. Revoke a suspected API client with `npm run client:revoke -- <client-id>` and rotate the signing key through a coordinated deployment. For a suspected database leak, isolate the service, rotate database credentials, preserve logs/backups, and follow the hosting provider's incident process.

## Known limits

- No human user identity provider, MFA, fine-grained per-vehicle permissions, or admin audit trail is implemented. The API client is an organization-wide machine credential.
- HS256 requires careful shared-key rotation; the current topology has one web service. A multi-web-instance deployment needs coordinated secret rotation and a shared Socket.IO adapter.
- Rate limiting is per-process, not distributed. Do not scale web replicas without adding and testing a shared store.
- Cloud backup configuration, restore rehearsal, domain/TLS, and external alerting require the operator's provider account and were not performed from this local workspace.
- This is a synthetic portfolio demonstration, not a security certification or production OEM integration.
