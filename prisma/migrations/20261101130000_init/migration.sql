-- CreateEnum
CREATE TYPE "ingestion_request_status" AS ENUM ('RECEIVED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'MALFORMED');

-- CreateEnum
CREATE TYPE "ingestion_event_status" AS ENUM ('PENDING', 'ACCEPTED', 'ACCEPTED_WITH_WARNINGS', 'QUARANTINED', 'DUPLICATE');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "vin" VARCHAR(32) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "raw_body" BYTEA NOT NULL,
    "parsed_payload" JSONB,
    "status" "ingestion_request_status" NOT NULL DEFAULT 'RECEIVED',
    "error_code" VARCHAR(100),
    "error_detail" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parsed_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ingestion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "external_event_id" TEXT,
    "raw_vin" TEXT,
    "payload" JSONB,
    "event_time" TIMESTAMPTZ(6),
    "status" "ingestion_event_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ingestion_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_readings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ingestion_event_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "source" VARCHAR(100) NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_time" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "speed_kph" DECIMAL(8,3) NOT NULL,
    "odometer_km" DECIMAL(12,3),
    "odometer_suspicious" BOOLEAN NOT NULL DEFAULT false,
    "fuel_percent" DECIMAL(5,2) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "engine_on" BOOLEAN,
    "accel_mss" DECIMAL(8,4),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "latest_reading_id" UUID NOT NULL,
    "last_event_time" TIMESTAMPTZ(6) NOT NULL,
    "trusted_odometer_km" DECIMAL(12,3),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quarantine_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "event_id" UUID,
    "vehicle_id" UUID,
    "source" TEXT NOT NULL,
    "raw_vin" TEXT,
    "reason" VARCHAR(100) NOT NULL,
    "detail" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quarantine_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "derived_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "source_reading_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "severity" VARCHAR(32) NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "explanation" TEXT NOT NULL,

    CONSTRAINT "derived_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "vehicles_source_vin_idx" ON "vehicles"("source", "vin");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_organization_id_vin_key" ON "vehicles"("organization_id", "vin");

-- CreateIndex
CREATE INDEX "ingestion_requests_organization_id_status_received_at_idx" ON "ingestion_requests"("organization_id", "status", "received_at");

-- CreateIndex
CREATE INDEX "ingestion_requests_organization_id_source_received_at_idx" ON "ingestion_requests"("organization_id", "source", "received_at" DESC);

-- CreateIndex
CREATE INDEX "ingestion_events_status_created_at_idx" ON "ingestion_events"("status", "created_at");

-- CreateIndex
CREATE INDEX "ingestion_events_source_raw_vin_external_event_id_idx" ON "ingestion_events"("source", "raw_vin", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_events_request_id_ordinal_key" ON "ingestion_events"("request_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_readings_ingestion_event_id_key" ON "telemetry_readings"("ingestion_event_id");

-- CreateIndex
CREATE INDEX "telemetry_readings_vehicle_id_event_time_idx" ON "telemetry_readings"("vehicle_id", "event_time" DESC);

-- CreateIndex
CREATE INDEX "telemetry_readings_vehicle_id_received_at_idx" ON "telemetry_readings"("vehicle_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_readings_source_vehicle_id_external_event_id_key" ON "telemetry_readings"("source", "vehicle_id", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_states_vehicle_id_key" ON "vehicle_states"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_states_latest_reading_id_key" ON "vehicle_states"("latest_reading_id");

-- CreateIndex
CREATE INDEX "quarantine_records_request_id_idx" ON "quarantine_records"("request_id");

-- CreateIndex
CREATE INDEX "quarantine_records_event_id_idx" ON "quarantine_records"("event_id");

-- CreateIndex
CREATE INDEX "quarantine_records_vehicle_id_idx" ON "quarantine_records"("vehicle_id");

-- CreateIndex
CREATE INDEX "quarantine_records_reason_created_at_idx" ON "quarantine_records"("reason", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "derived_events_dedupe_key_key" ON "derived_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "derived_events_vehicle_id_occurred_at_idx" ON "derived_events"("vehicle_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "derived_events_event_type_occurred_at_idx" ON "derived_events"("event_type", "occurred_at" DESC);

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_requests" ADD CONSTRAINT "ingestion_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_events" ADD CONSTRAINT "ingestion_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "ingestion_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_ingestion_event_id_fkey" FOREIGN KEY ("ingestion_event_id") REFERENCES "ingestion_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_readings" ADD CONSTRAINT "telemetry_readings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_states" ADD CONSTRAINT "vehicle_states_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_states" ADD CONSTRAINT "vehicle_states_latest_reading_id_fkey" FOREIGN KEY ("latest_reading_id") REFERENCES "telemetry_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "ingestion_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ingestion_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quarantine_records" ADD CONSTRAINT "quarantine_records_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derived_events" ADD CONSTRAINT "derived_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "derived_events" ADD CONSTRAINT "derived_events_source_reading_id_fkey" FOREIGN KEY ("source_reading_id") REFERENCES "telemetry_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Prisma's schema DSL does not model CHECK constraints. Keep these explicit
-- PostgreSQL checks in the migration so all write paths, including raw SQL,
-- enforce the canonical data ranges.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_nonempty_ck"
  CHECK (length(btrim("slug")) > 0);

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_vin_nonempty_ck"
  CHECK (length(btrim("vin")) > 0);

ALTER TABLE "ingestion_events"
  ADD CONSTRAINT "ingestion_events_ordinal_nonnegative_ck"
  CHECK ("ordinal" >= 0);

ALTER TABLE "telemetry_readings"
  ADD CONSTRAINT "telemetry_speed_range_ck"
  CHECK ("speed_kph" >= 0 AND "speed_kph" <= 400),
  ADD CONSTRAINT "telemetry_fuel_range_ck"
  CHECK ("fuel_percent" >= 0 AND "fuel_percent" <= 100),
  ADD CONSTRAINT "telemetry_latitude_range_ck"
  CHECK ("latitude" >= -90 AND "latitude" <= 90),
  ADD CONSTRAINT "telemetry_longitude_range_ck"
  CHECK ("longitude" >= -180 AND "longitude" <= 180),
  ADD CONSTRAINT "telemetry_odometer_nonnegative_ck"
  CHECK ("odometer_km" IS NULL OR "odometer_km" >= 0),
  ADD CONSTRAINT "telemetry_suspicious_odometer_present_ck"
  CHECK (NOT "odometer_suspicious" OR "odometer_km" IS NOT NULL),
  ADD CONSTRAINT "telemetry_event_id_nonempty_ck"
  CHECK (length(btrim("external_event_id")) > 0);

ALTER TABLE "vehicle_states"
  ADD CONSTRAINT "vehicle_state_odometer_nonnegative_ck"
  CHECK ("trusted_odometer_km" IS NULL OR "trusted_odometer_km" >= 0);

ALTER TABLE "quarantine_records"
  ADD CONSTRAINT "quarantine_reason_nonempty_ck"
  CHECK (length(btrim("reason")) > 0);

ALTER TABLE "derived_events"
  ADD CONSTRAINT "derived_event_dedupe_key_nonempty_ck"
  CHECK (length(btrim("dedupe_key")) > 0),
  ADD CONSTRAINT "derived_event_type_nonempty_ck"
  CHECK (length(btrim("event_type")) > 0);
