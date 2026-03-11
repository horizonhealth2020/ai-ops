CREATE TABLE cached_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  technician_id VARCHAR(100),
  cache_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, date, start_time)
);

CREATE INDEX idx_cached_availability_lookup ON cached_availability(client_id, date, status);
