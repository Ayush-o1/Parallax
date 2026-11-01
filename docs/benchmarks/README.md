# Benchmark results

The historical runs used the local Docker Compose stack on an Apple Silicon host (Darwin 27.0.0, 10 CPU cores, 16 GiB RAM), Node.js v24.22.1, and PostgreSQL 18.6. The production-shaped run below uses the same host with a separate Docker Compose web/worker/PostgreSQL/Redis stack. All results measure this local machine, not a production service-level objective.

## 10,000-event comparison

Each run submitted 10,000 direct events and 10,000 events in batches of 25, with 16 concurrent API requests and one vehicle. Both used asynchronous Redis/BullMQ ingestion and the same local database and Kafka-compatible broker. The worker concurrency differed.

| Worker concurrency | Direct throughput | Direct API p95 | Batch throughput | Batch API p95 | Processing completion p95 | Errors |
|---:|---:|---:|---:|---:|---:|---:|
| 8 | 1,120 events/s | 22.75 ms | 2,188 events/s | 13.54 ms | 18.27 s | 0% |
| 16 | 1,204 events/s | 21.02 ms | 2,366 events/s | 13.69 ms | 16.31 s | 0% |

At concurrency 16, the workload persisted and published all 20,001 outbox records (including the deliberate duplicate receipt), and each Kafka consumer group recorded 20,001 inbox entries. The duplicate did not create another normalized reading. History reads used `telemetry_readings_vehicle_id_event_time_idx`; the 50-row query completed in 0.027 ms in the reported plan.

Increasing worker concurrency from 8 to 16 reduced request-completion p95 by about 10.8% in these runs. The 20,000-event workload still took 16.31 seconds at p95 to finish processing, so API acceptance latency should not be read as end-to-end processing latency. The observed result supports 16 as the local default; production sizing requires measurements on the target database, Redis, broker, and hardware.

## 1,000-event smoke benchmark

The smaller run used 1,000 direct and 1,000 batched events, with complete outbox publication and inbox verification. It recorded 904 direct events/s, 2,619 batch events/s, zero errors, and a 1.58-second request-completion p95.

## Production-shaped Compose topology

The fresh 2026-11-01 reports use the production Docker image, authenticated API clients, PostgreSQL, Redis/BullMQ, and a worker at concurrency 4. Kafka is disabled as it is in the recommended demo deployment. The 1,000-event run used the default 1,200-request/minute limit; the 10,000-event run raised only that local benchmark limit to 50,000 requests/minute so the direct-event leg could complete. Neither run had HTTP failures or rejected events.

| Events per mode | API limit | Direct throughput / p95 | Batch throughput / p95 | Processing completion p95 | Persisted readings | Errors |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 1,200/min | 1,259 events/s / 16.77 ms | 2,868 events/s / 11.18 ms | 1.14 s | 2,000 | 0% |
| 10,000 | 50,000/min | 1,479 events/s / 15.29 ms | 2,908 events/s / 9.71 ms | 10.67 s | 20,000 | 0% |

The benchmark's direct throughput measures API receipt/queueing latency, while request-completion p95 measures worker processing completion. The 10K API-limit override is recorded in its report and is not the hosted deployment's configured limit. These Kafka-disabled runs do not measure outbox publication; the earlier Kafka-enabled reports above cover that topology.

## Raw reports

- [1,000-event report](benchmark-1000-2026-11-01.json)
- [1,000-event production-shaped Compose report](benchmark-1000-2026-11-01-production-topology.json)
- [10,000-event production-shaped Compose report](benchmark-10000-2026-11-01-production-topology.json)
- [10,000-event report, worker concurrency 8](benchmark-10000-worker-8-2026-11-01.json)
- [10,000-event report, worker concurrency 16](benchmark-10000-worker-16-2026-11-01.json)

Reports include API latency percentiles, accepted/duplicate/error counts, persisted and published outbox totals, inbox totals per consumer, request completion times, and the telemetry history query plan.
