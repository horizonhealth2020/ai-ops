CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  call_id VARCHAR(100) NOT NULL,
  caller_name VARCHAR(255) NOT NULL,
  caller_phone VARCHAR(20) NOT NULL,
  caller_email VARCHAR(255),
  caller_address TEXT,
  service_type VARCHAR(100) NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  duration_min INTEGER,
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  external_job_id VARCHAR(100),
  fsm_sync_status VARCHAR(20) DEFAULT 'pending',
  payment_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookings_client ON bookings(client_id);
CREATE INDEX idx_bookings_date ON bookings(client_id, scheduled_date);
CREATE INDEX idx_bookings_caller ON bookings(caller_phone);
