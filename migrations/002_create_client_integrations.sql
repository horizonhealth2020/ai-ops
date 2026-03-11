CREATE TABLE client_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  integration_type VARCHAR(30) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  credentials_encrypted BYTEA NOT NULL,
  config JSONB DEFAULT '{}',
  webhook_url VARCHAR(500),
  token_cache_key VARCHAR(100),
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(20) DEFAULT 'healthy',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_client_integrations_client ON client_integrations(client_id);
CREATE INDEX idx_client_integrations_type ON client_integrations(client_id, integration_type);
