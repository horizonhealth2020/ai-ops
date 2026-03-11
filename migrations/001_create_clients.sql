CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255) NOT NULL,
  contact_email VARCHAR(255) NOT NULL,
  contact_phone VARCHAR(20) NOT NULL,
  business_phone VARCHAR(20) UNIQUE NOT NULL,
  website VARCHAR(500),
  service_area TEXT NOT NULL,
  vertical VARCHAR(50) NOT NULL,
  business_description TEXT,
  agent_name VARCHAR(100) NOT NULL DEFAULT 'Alex',
  agent_voice VARCHAR(20) DEFAULT 'female',
  greeting_script TEXT,
  tone_tags TEXT[] DEFAULT '{}',
  languages TEXT[] DEFAULT '{english}',
  phrases_use TEXT,
  phrases_avoid TEXT,
  transfer_number VARCHAR(20),
  transfer_name VARCHAR(100),
  transfer_fallback VARCHAR(30) DEFAULT 'take_message',
  after_hours_handling VARCHAR(30) DEFAULT 'message_only',
  after_hours_notes TEXT,
  angry_handling VARCHAR(30) DEFAULT 'deescalate_first',
  reject_calls TEXT,
  additional_rules TEXT,
  differentiators TEXT,
  warranties TEXT,
  promotions TEXT,
  system_prompt TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'onboarding',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_business_phone ON clients(business_phone);
CREATE INDEX idx_clients_status ON clients(status);
