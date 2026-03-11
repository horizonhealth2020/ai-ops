CREATE TABLE scheduling_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID UNIQUE NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  software VARCHAR(50) NOT NULL,
  slot_duration_min INTEGER NOT NULL DEFAULT 60,
  buffer_min INTEGER NOT NULL DEFAULT 15,
  max_per_day INTEGER NOT NULL DEFAULT 8,
  booking_confirm VARCHAR(20) NOT NULL DEFAULT 'yes',
  booking_info_required TEXT[] DEFAULT '{name,phone,address,issue_description}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
