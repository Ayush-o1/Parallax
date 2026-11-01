CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "event_key" VARCHAR(300) NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_until" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kafka_inbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "consumer_group" VARCHAR(200) NOT NULL,
    "event_key" VARCHAR(300) NOT NULL,
    "topic" VARCHAR(200) NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" BIGINT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kafka_inbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_events_event_key_key" ON "outbox_events"("event_key");
CREATE INDEX "outbox_events_published_at_available_at_claimed_until_created_at_idx"
    ON "outbox_events"("published_at", "available_at", "claimed_until", "created_at");
CREATE UNIQUE INDEX "kafka_inbox_consumer_group_event_key_key" ON "kafka_inbox"("consumer_group", "event_key");
CREATE UNIQUE INDEX "kafka_inbox_consumer_group_topic_partition_offset_key"
    ON "kafka_inbox"("consumer_group", "topic", "partition", "offset");
CREATE INDEX "kafka_inbox_processed_at_idx" ON "kafka_inbox"("processed_at");

ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
