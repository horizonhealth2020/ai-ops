CREATE TABLE appointment_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  duration_min INTEGER NOT NULL,
  fsm_job_type_id VARCHAR(100),
  color VARCHAR(7) DEFAULT '#2563eb',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_appointment_types_client ON appointment_types(client_id);
