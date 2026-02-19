-- AI Ops Backend — Database Schema
-- Run: psql $DATABASE_URL < schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE after_hours_enum AS ENUM ('voicemail', 'emergency_transfer', 'message_only');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────
-- Clients (one row per tenant)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name     VARCHAR(255) NOT NULL,
  phone_number     VARCHAR(20)  NOT NULL UNIQUE,
  industry_vertical VARCHAR(50) NOT NULL CHECK (industry_vertical IN ('hvac', 'plumbing', 'spa')),
  crm_platform     VARCHAR(50)  NOT NULL DEFAULT 'stub',
  crm_credentials  JSONB,
  timezone         VARCHAR(100) NOT NULL DEFAULT 'America/New_York',
  active           BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone_active
  ON clients(phone_number) WHERE active = true;

-- ─────────────────────────────────────────────
-- Services offered by each client
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_name     VARCHAR(255) NOT NULL,
  base_price       NUMERIC(10,2),
  duration_minutes INTEGER      NOT NULL DEFAULT 60,
  requires_deposit BOOLEAN      NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_services_client ON services(client_id);

-- ─────────────────────────────────────────────
-- Per-client call configuration
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_configs (
  id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID              NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  business_hours        JSONB,
  after_hours_behavior  after_hours_enum  NOT NULL DEFAULT 'voicemail',
  transfer_number       VARCHAR(20),
  emergency_keywords    TEXT[],
  tone_override         VARCHAR(255),
  faq_content           JSONB
);

-- ─────────────────────────────────────────────
-- Call history / outcomes
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_logs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        UUID         NOT NULL REFERENCES clients(id),
  call_id          VARCHAR(255) NOT NULL,
  caller_number    VARCHAR(20),
  outcome          VARCHAR(100),
  summary          TEXT,
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_logs_client_created
  ON call_logs(client_id, created_at DESC);
