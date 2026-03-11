CREATE TABLE business_hours (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  is_open BOOLEAN NOT NULL DEFAULT true,
  open_time TIME,
  close_time TIME,
  after_hours_mode VARCHAR(30) DEFAULT 'message_only',
  UNIQUE(client_id, day_of_week)
);

CREATE INDEX idx_business_hours_client ON business_hours(client_id);
