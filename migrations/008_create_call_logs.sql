CREATE TABLE call_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id VARCHAR(100) UNIQUE NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caller_phone VARCHAR(20),
  caller_name VARCHAR(255),
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  intent VARCHAR(50),
  outcome VARCHAR(50),
  booking_id UUID REFERENCES bookings(id),
  transcript_summary TEXT,
  recording_url VARCHAR(500),
  sync_status VARCHAR(20) DEFAULT 'pending',
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_call_logs_client ON call_logs(client_id);
CREATE INDEX idx_call_logs_caller ON call_logs(caller_phone);
CREATE INDEX idx_call_logs_date ON call_logs(client_id, created_at DESC);
