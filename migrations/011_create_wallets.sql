CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID UNIQUE NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  auto_reload_enabled BOOLEAN DEFAULT false,
  auto_reload_threshold_cents INTEGER DEFAULT 500,
  auto_reload_amount_cents INTEGER DEFAULT 5000,
  tier VARCHAR(20) DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
