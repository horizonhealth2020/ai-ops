-- AI Ops Backend — Seed Data
-- One demo client per vertical for immediate testability
-- Run AFTER schema.sql: psql $DATABASE_URL < seed.sql

BEGIN;

-- ─────────────────────────────────────────────
-- HVAC Demo Client
-- ─────────────────────────────────────────────
WITH hvac_insert AS (
  INSERT INTO clients (company_name, phone_number, industry_vertical, crm_platform, crm_credentials, timezone, active)
  VALUES (
    'Arctic Air HVAC',
    '+15551234567',
    'hvac',
    'stub',
    '{}',
    'America/Chicago',
    true
  )
  ON CONFLICT (phone_number) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO services (client_id, service_name, base_price, duration_minutes, requires_deposit)
SELECT id, unnest(ARRAY['AC Tune-Up', 'Furnace Installation', 'Duct Cleaning', 'Filter Replacement', 'Emergency Repair']),
       unnest(ARRAY[89.00, 3500.00, 299.00, 49.00, 149.00]::NUMERIC[]),
       unnest(ARRAY[60, 240, 120, 30, 90]::INTEGER[]),
       unnest(ARRAY[false, true, false, false, false]::BOOLEAN[])
FROM hvac_insert
ON CONFLICT DO NOTHING;

WITH hvac AS (SELECT id FROM clients WHERE phone_number = '+15551234567')
INSERT INTO call_configs (client_id, business_hours, after_hours_behavior, transfer_number, emergency_keywords, tone_override, faq_content)
SELECT
  id,
  '{"monday":{"open":"08:00","close":"17:00"},"tuesday":{"open":"08:00","close":"17:00"},"wednesday":{"open":"08:00","close":"17:00"},"thursday":{"open":"08:00","close":"17:00"},"friday":{"open":"08:00","close":"17:00"},"saturday":{"open":"09:00","close":"13:00"}}'::jsonb,
  'emergency_transfer',
  '+15559990001',
  ARRAY['no heat', 'no ac', 'gas leak', 'carbon monoxide', 'co detector', 'emergency', 'burst pipe', 'flooding'],
  'professional, friendly, and knowledgeable',
  '{"service_area":"Greater Chicago metro","warranty":"1 year parts and labor on all installations","financing":"0% APR for 18 months available","brands_serviced":"Carrier, Trane, Lennox, Rheem, Goodman"}'::jsonb
FROM hvac
ON CONFLICT (client_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- Plumbing Demo Client
-- ─────────────────────────────────────────────
WITH plumbing_insert AS (
  INSERT INTO clients (company_name, phone_number, industry_vertical, crm_platform, crm_credentials, timezone, active)
  VALUES (
    'FlowMaster Plumbing',
    '+15552345678',
    'plumbing',
    'stub',
    '{}',
    'America/Los_Angeles',
    true
  )
  ON CONFLICT (phone_number) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO services (client_id, service_name, base_price, duration_minutes, requires_deposit)
SELECT id, unnest(ARRAY['Drain Clearing', 'Leak Repair', 'Water Heater Replacement', 'Pipe Inspection', 'Emergency Burst Pipe']),
       unnest(ARRAY[129.00, 199.00, 1200.00, 99.00, 299.00]::NUMERIC[]),
       unnest(ARRAY[60, 90, 180, 45, 120]::INTEGER[]),
       unnest(ARRAY[false, false, true, false, false]::BOOLEAN[])
FROM plumbing_insert
ON CONFLICT DO NOTHING;

WITH plumbing AS (SELECT id FROM clients WHERE phone_number = '+15552345678')
INSERT INTO call_configs (client_id, business_hours, after_hours_behavior, transfer_number, emergency_keywords, tone_override, faq_content)
SELECT
  id,
  '{"monday":{"open":"07:00","close":"18:00"},"tuesday":{"open":"07:00","close":"18:00"},"wednesday":{"open":"07:00","close":"18:00"},"thursday":{"open":"07:00","close":"18:00"},"friday":{"open":"07:00","close":"18:00"},"saturday":{"open":"08:00","close":"14:00"}}'::jsonb,
  'emergency_transfer',
  '+15559990002',
  ARRAY['burst pipe', 'flooding', 'water everywhere', 'emergency', 'sewage', 'gas smell', 'no water'],
  'calm, reassuring, and efficient',
  '{"service_area":"Los Angeles and surrounding areas","warranty":"90 days on all repairs","emergency_rate":"$199 dispatch fee for after-hours calls","accepted_payment":"Cash, check, all major credit cards"}'::jsonb
FROM plumbing
ON CONFLICT (client_id) DO NOTHING;

-- ─────────────────────────────────────────────
-- Spa Demo Client
-- ─────────────────────────────────────────────
WITH spa_insert AS (
  INSERT INTO clients (company_name, phone_number, industry_vertical, crm_platform, crm_credentials, timezone, active)
  VALUES (
    'Serenity Day Spa',
    '+15553456789',
    'spa',
    'stub',
    '{}',
    'America/New_York',
    true
  )
  ON CONFLICT (phone_number) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO services (client_id, service_name, base_price, duration_minutes, requires_deposit)
SELECT id, unnest(ARRAY['Swedish Massage', 'Deep Tissue Massage', 'Hot Stone Massage', 'Couples Massage', 'Facial']),
       unnest(ARRAY[95.00, 110.00, 125.00, 195.00, 85.00]::NUMERIC[]),
       unnest(ARRAY[60, 60, 90, 90, 60]::INTEGER[]),
       unnest(ARRAY[false, false, false, true, false]::BOOLEAN[])
FROM spa_insert
ON CONFLICT DO NOTHING;

WITH spa AS (SELECT id FROM clients WHERE phone_number = '+15553456789')
INSERT INTO call_configs (client_id, business_hours, after_hours_behavior, transfer_number, emergency_keywords, tone_override, faq_content)
SELECT
  id,
  '{"monday":{"open":"10:00","close":"20:00"},"tuesday":{"open":"10:00","close":"20:00"},"wednesday":{"open":"10:00","close":"20:00"},"thursday":{"open":"10:00","close":"20:00"},"friday":{"open":"10:00","close":"21:00"},"saturday":{"open":"09:00","close":"21:00"},"sunday":{"open":"10:00","close":"18:00"}}'::jsonb,
  'message_only',
  '+15559990003',
  ARRAY['allergic reaction', 'medical emergency', 'injury'],
  'warm, soothing, and welcoming',
  '{"cancellation_policy":"24-hour notice required, 50% fee for late cancellations","gratuity":"Gratuity not included, 18-20% customary","parking":"Free parking in our lot","intake_forms":"Please arrive 10 minutes early to complete intake forms"}'::jsonb
FROM spa
ON CONFLICT (client_id) DO NOTHING;

COMMIT;
