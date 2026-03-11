-- AI Ops Backend — Seed Data
-- 3 demo clients with full configurations
-- Run AFTER migrations: npm run seed

BEGIN;

-- ─────────────────────────────────────────────
-- 1. Apex Plumbing & HVAC (vertical: hvac)
-- ─────────────────────────────────────────────
INSERT INTO clients (
  id, business_name, contact_name, contact_email, contact_phone, business_phone,
  service_area, vertical, business_description, agent_name, agent_voice,
  greeting_script, tone_tags, languages, transfer_number, transfer_name,
  transfer_fallback, after_hours_handling, angry_handling,
  differentiators, warranties, promotions, status, system_prompt
) VALUES (
  uuid_generate_v4(),
  'Apex Plumbing & HVAC',
  'Maria Rodriguez',
  'maria@apexphvac.com',
  '+19545550101',
  '+19545550100',
  'South Florida — Broward and Palm Beach counties',
  'hvac',
  'Full-service HVAC and plumbing company serving South Florida since 2008. Licensed, insured, and BBB accredited.',
  'Alex',
  'female',
  'Thank you for calling Apex Plumbing and HVAC! This is Alex, how can I help you today?',
  '{friendly,professional}',
  '{english,spanish}',
  '+19545550199',
  'Maria at Dispatch',
  'take_message',
  'message_only',
  'deescalate_first',
  'Same-day service available. 24/7 emergency line. Licensed and insured. BBB A+ rated. All technicians background-checked.',
  '1-year parts and labor warranty on all installations. 90-day warranty on repairs.',
  '10% off first-time customers. Free AC diagnostic with any repair.',
  'active',
  E'You are Alex, a friendly and professional AI phone agent for Apex Plumbing & HVAC.\n\nCompany: Apex Plumbing & HVAC\nService Area: South Florida — Broward and Palm Beach counties\nBusiness Hours: Mon-Fri 8am-6pm, Sat 9am-3pm, Sun closed\n\nServices:\n- AC Repair: $89 diagnostic fee\n- AC Installation: Call for quote\n- AC Tune-Up: $129\n- Duct Cleaning: $299\n- Thermostat Install: $75 + parts\n- Emergency Service: $149 dispatch fee\n- Annual Maintenance Plan: $189/year\n\nTone: Friendly and professional. Always be helpful and empathetic.\nLanguages: English, Spanish\n\nTransfer: If the caller wants to speak to a human, transfer to Maria at Dispatch.\nAfter Hours: Take a message and let them know someone will call back next business day.\nAngry Callers: De-escalate first, then offer to transfer if needed.\n\nWarranties: 1-year parts and labor on installations, 90-day on repairs.\nPromotions: 10% off first-time customers. Free AC diagnostic with any repair.\nDifferentiators: Same-day service, 24/7 emergency, BBB A+ rated, background-checked technicians.\n\nAvailable tools: check_availability, hold_slot, create_booking, transfer_call, create_payment'
) ON CONFLICT (business_phone) DO NOTHING;

-- Business hours for Apex
INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time)
SELECT c.id, d.day, d.is_open, d.open_time::TIME, d.close_time::TIME
FROM clients c,
(VALUES
  (0, true, '08:00', '18:00'),
  (1, true, '08:00', '18:00'),
  (2, true, '08:00', '18:00'),
  (3, true, '08:00', '18:00'),
  (4, true, '08:00', '18:00'),
  (5, true, '09:00', '15:00'),
  (6, false, NULL, NULL)
) AS d(day, is_open, open_time, close_time)
WHERE c.business_phone = '+19545550100'
ON CONFLICT (client_id, day_of_week) DO NOTHING;

-- Scheduling config for Apex
INSERT INTO scheduling_config (client_id, software, slot_duration_min, buffer_min, max_per_day, booking_confirm)
SELECT id, 'housecall_pro', 60, 15, 10, 'yes'
FROM clients WHERE business_phone = '+19545550100'
ON CONFLICT (client_id) DO NOTHING;

-- Appointment types for Apex
INSERT INTO appointment_types (client_id, name, duration_min, fsm_job_type_id)
SELECT c.id, t.name, t.duration, t.fsm_id
FROM clients c,
(VALUES
  ('AC Repair', 90, 'hcp_ac_repair'),
  ('AC Installation', 240, 'hcp_ac_install'),
  ('AC Tune-Up', 60, 'hcp_ac_tuneup'),
  ('Duct Cleaning', 120, 'hcp_duct_clean'),
  ('Thermostat Install', 60, 'hcp_thermostat'),
  ('Emergency Service', 120, 'hcp_emergency'),
  ('Annual Maintenance Plan', 90, 'hcp_annual')
) AS t(name, duration, fsm_id)
WHERE c.business_phone = '+19545550100';

-- Wallet for Apex
INSERT INTO wallets (client_id, balance_cents, tier)
SELECT id, 5000, 'standard'
FROM clients WHERE business_phone = '+19545550100'
ON CONFLICT (client_id) DO NOTHING;

-- FAQ embeddings for Apex (zero vectors as placeholders)
INSERT INTO faq_embeddings (client_id, question, answer, embedding, category)
SELECT c.id, f.question, f.answer, f.embedding::vector, f.category
FROM clients c,
(VALUES
  ('How much does an AC repair cost?', 'Our AC diagnostic fee is $89, which is applied toward the cost of repair. Final repair costs depend on the issue found during diagnosis.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'pricing'),
  ('Do you offer financing?', 'Yes! We offer 0% APR financing for 18 months on installations over $2,000. Ask about our monthly payment options.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'pricing'),
  ('What areas do you serve?', 'We serve all of Broward and Palm Beach counties in South Florida, including Fort Lauderdale, Boca Raton, West Palm Beach, and surrounding areas.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'service'),
  ('Do you offer emergency service?', 'Yes, we offer 24/7 emergency service with a $149 dispatch fee. A technician can typically arrive within 2 hours for emergencies.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'service'),
  ('What brands do you work with?', 'We service all major HVAC brands including Carrier, Trane, Lennox, Rheem, and Goodman. We also install new systems from these manufacturers.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'general')
) AS f(question, answer, embedding, category)
WHERE c.business_phone = '+19545550100';


-- ─────────────────────────────────────────────
-- 2. Zen Day Spa (vertical: spa)
-- ─────────────────────────────────────────────
INSERT INTO clients (
  id, business_name, contact_name, contact_email, contact_phone, business_phone,
  service_area, vertical, business_description, agent_name, agent_voice,
  greeting_script, tone_tags, languages, transfer_number, transfer_name,
  transfer_fallback, after_hours_handling, angry_handling,
  differentiators, warranties, promotions, status, system_prompt
) VALUES (
  uuid_generate_v4(),
  'Zen Day Spa',
  'Lisa Chen',
  'lisa@zendayspa.com',
  '+13055550201',
  '+13055550200',
  'Miami — Coral Gables and Coconut Grove',
  'spa',
  'Luxury day spa offering massage, facial, and body treatments in a serene environment. Open since 2015.',
  'Sarah',
  'female',
  'Welcome to Zen Day Spa! This is Sarah, how may I help you today?',
  '{empathetic,casual}',
  '{english}',
  '+13055550299',
  'Front Desk',
  'take_message',
  'message_only',
  'deescalate_first',
  'Award-winning spa. Organic products only. Private treatment rooms. Complimentary tea service.',
  'Satisfaction guaranteed. If you are not happy with your treatment, we will make it right.',
  'Couples massage package — book 2 get 15% off. New client special: $20 off first visit.',
  'active',
  E'You are Sarah, a warm and welcoming AI phone agent for Zen Day Spa.\n\nCompany: Zen Day Spa\nService Area: Miami — Coral Gables and Coconut Grove\nBusiness Hours: Tue-Sun 10am-8pm, Mon closed\n\nServices:\n- Swedish Massage (60min): $89\n- Deep Tissue Massage (60min): $109\n- Facial (60min): $79\n- Couples Massage (90min): $169\n- Hot Stone Massage (75min): $99\n- Aromatherapy Add-on: $25\n\nTone: Warm, empathetic, and casual. Make callers feel relaxed.\n\nTransfer: If caller needs to speak to someone, transfer to Front Desk.\nAfter Hours: Take a message and let them know we will call back when we open.\nAngry Callers: De-escalate with empathy, offer to transfer if needed.\n\nPolicies: 24-hour cancellation notice required, 50% fee for late cancellations. Gratuity not included (18-20% customary). Please arrive 10 minutes early.\nPromotions: Couples massage — book 2 get 15% off. New client: $20 off first visit.\nDifferentiators: Award-winning spa, organic products, private rooms, complimentary tea.\n\nAvailable tools: check_availability, hold_slot, create_booking, transfer_call, create_payment'
) ON CONFLICT (business_phone) DO NOTHING;

-- Business hours for Zen
INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time)
SELECT c.id, d.day, d.is_open, d.open_time::TIME, d.close_time::TIME
FROM clients c,
(VALUES
  (0, false, NULL, NULL),
  (1, true, '10:00', '20:00'),
  (2, true, '10:00', '20:00'),
  (3, true, '10:00', '20:00'),
  (4, true, '10:00', '20:00'),
  (5, true, '10:00', '20:00'),
  (6, true, '10:00', '20:00')
) AS d(day, is_open, open_time, close_time)
WHERE c.business_phone = '+13055550200'
ON CONFLICT (client_id, day_of_week) DO NOTHING;

-- Scheduling config for Zen
INSERT INTO scheduling_config (client_id, software, slot_duration_min, buffer_min, max_per_day, booking_confirm)
SELECT id, 'google_calendar', 60, 15, 12, 'yes'
FROM clients WHERE business_phone = '+13055550200'
ON CONFLICT (client_id) DO NOTHING;

-- Appointment types for Zen
INSERT INTO appointment_types (client_id, name, duration_min)
SELECT c.id, t.name, t.duration
FROM clients c,
(VALUES
  ('Swedish Massage', 60),
  ('Deep Tissue Massage', 60),
  ('Facial', 60),
  ('Couples Massage', 90),
  ('Hot Stone Massage', 75),
  ('Aromatherapy Add-on', 30)
) AS t(name, duration)
WHERE c.business_phone = '+13055550200';

-- Wallet for Zen
INSERT INTO wallets (client_id, balance_cents, tier)
SELECT id, 5000, 'standard'
FROM clients WHERE business_phone = '+13055550200'
ON CONFLICT (client_id) DO NOTHING;

-- FAQ embeddings for Zen
INSERT INTO faq_embeddings (client_id, question, answer, embedding, category)
SELECT c.id, f.question, f.answer, f.embedding::vector, f.category
FROM clients c,
(VALUES
  ('What is your cancellation policy?', '24-hour cancellation notice is required. Late cancellations are subject to a 50% fee. No-shows are charged the full service price.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'general'),
  ('Is gratuity included?', 'Gratuity is not included in our service prices. 18-20% is customary for spa services. We accept cash tips or you can add gratuity to your card.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'pricing'),
  ('Do you offer couples massages?', 'Yes! Our couples massage is 90 minutes in a private dual room for $169. We are currently running a special — book 2 sessions and get 15% off.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'service'),
  ('What should I wear to my appointment?', 'We provide robes, slippers, and disposable undergarments. You can undress to your comfort level. Please arrive 10 minutes early to fill out intake forms and enjoy our tea lounge.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'general'),
  ('Do you use organic products?', 'Yes, all of our products are organic and cruelty-free. We use premium botanical oils and natural ingredients in all treatments.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'general')
) AS f(question, answer, embedding, category)
WHERE c.business_phone = '+13055550200';


-- ─────────────────────────────────────────────
-- 3. Elite Electrical Solutions (vertical: electrical)
-- ─────────────────────────────────────────────
INSERT INTO clients (
  id, business_name, contact_name, contact_email, contact_phone, business_phone,
  service_area, vertical, business_description, agent_name, agent_voice,
  greeting_script, tone_tags, languages, transfer_number, transfer_name,
  transfer_fallback, after_hours_handling, angry_handling,
  differentiators, warranties, promotions, status, system_prompt
) VALUES (
  uuid_generate_v4(),
  'Elite Electrical Solutions',
  'David Martinez',
  'david@eliteelectrical.com',
  '+19545550301',
  '+19545550300',
  'South Florida — Broward County',
  'electrical',
  'Licensed master electrician serving residential and commercial clients. Specializing in panel upgrades, whole-home rewiring, and smart home installations.',
  'Mike',
  'male',
  'Elite Electrical Solutions, this is Mike. How can I help you?',
  '{professional,direct}',
  '{english}',
  '+19545550399',
  'David at Dispatch',
  'take_message',
  'message_only',
  'deescalate_first',
  'Licensed master electrician. Same-day service available. Free estimates on major jobs. 100% satisfaction guarantee.',
  '2-year warranty on all electrical work. Lifetime warranty on panel upgrades.',
  'Free safety inspection with any service call. 15% senior discount.',
  'active',
  E'You are Mike, a professional and direct AI phone agent for Elite Electrical Solutions.\n\nCompany: Elite Electrical Solutions\nService Area: South Florida — Broward County\nBusiness Hours: Mon-Fri 8am-5pm, Sat-Sun closed\n\nServices:\n- Service Call: $95\n- Panel Upgrade: Call for quote\n- Outlet/Switch Install: $75\n- Ceiling Fan Install: $85\n- Electrical Inspection: $65\n- Emergency Service: $150 dispatch fee\n\nTone: Professional and direct. Be efficient with the caller''s time.\n\nTransfer: If caller needs to speak to someone, transfer to David at Dispatch.\nAfter Hours: Take a message and let them know we will call back next business day.\nAngry Callers: De-escalate first, then offer to transfer if needed.\n\nWarranties: 2-year warranty on all work. Lifetime warranty on panel upgrades.\nPromotions: Free safety inspection with any service call. 15% senior discount.\nDifferentiators: Licensed master electrician, same-day service, free estimates, 100% satisfaction guarantee.\n\nAvailable tools: check_availability, hold_slot, create_booking, transfer_call, create_payment'
) ON CONFLICT (business_phone) DO NOTHING;

-- Business hours for Elite
INSERT INTO business_hours (client_id, day_of_week, is_open, open_time, close_time)
SELECT c.id, d.day, d.is_open, d.open_time::TIME, d.close_time::TIME
FROM clients c,
(VALUES
  (0, true, '08:00', '17:00'),
  (1, true, '08:00', '17:00'),
  (2, true, '08:00', '17:00'),
  (3, true, '08:00', '17:00'),
  (4, true, '08:00', '17:00'),
  (5, false, NULL, NULL),
  (6, false, NULL, NULL)
) AS d(day, is_open, open_time, close_time)
WHERE c.business_phone = '+19545550300'
ON CONFLICT (client_id, day_of_week) DO NOTHING;

-- Scheduling config for Elite
INSERT INTO scheduling_config (client_id, software, slot_duration_min, buffer_min, max_per_day, booking_confirm)
SELECT id, 'jobber', 60, 15, 8, 'yes'
FROM clients WHERE business_phone = '+19545550300'
ON CONFLICT (client_id) DO NOTHING;

-- Appointment types for Elite
INSERT INTO appointment_types (client_id, name, duration_min, fsm_job_type_id)
SELECT c.id, t.name, t.duration, t.fsm_id
FROM clients c,
(VALUES
  ('Service Call', 60, 'jb_service_call'),
  ('Panel Upgrade', 240, 'jb_panel_upgrade'),
  ('Outlet/Switch Install', 45, 'jb_outlet_install'),
  ('Ceiling Fan Install', 60, 'jb_fan_install'),
  ('Electrical Inspection', 60, 'jb_inspection'),
  ('Emergency Service', 120, 'jb_emergency')
) AS t(name, duration, fsm_id)
WHERE c.business_phone = '+19545550300';

-- Wallet for Elite
INSERT INTO wallets (client_id, balance_cents, tier)
SELECT id, 5000, 'standard'
FROM clients WHERE business_phone = '+19545550300'
ON CONFLICT (client_id) DO NOTHING;

-- FAQ embeddings for Elite
INSERT INTO faq_embeddings (client_id, question, answer, embedding, category)
SELECT c.id, f.question, f.answer, f.embedding::vector, f.category
FROM clients c,
(VALUES
  ('How much does a service call cost?', 'Our standard service call is $95, which includes diagnosis. If you proceed with the repair, the diagnostic fee is applied toward the total cost.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'pricing'),
  ('Do you offer free estimates?', 'Yes, we offer free estimates on major jobs like panel upgrades, whole-home rewiring, and new construction. Service calls for smaller repairs have a $95 diagnostic fee.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'pricing'),
  ('Are you licensed?', 'Yes, our owner David Martinez is a licensed master electrician in the state of Florida. We are fully licensed, insured, and bonded.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'general'),
  ('Do you handle emergency electrical work?', 'Yes, we offer emergency electrical service with a $150 dispatch fee. Call us anytime — if it is after hours, leave a message and we will call you back as soon as possible.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'service'),
  ('What warranty do you offer?', 'We provide a 2-year warranty on all electrical work and a lifetime warranty on panel upgrades. All warranties are backed by our 100% satisfaction guarantee.', ('[' || array_to_string(array_fill(0::float, ARRAY[1536]), ',') || ']'), 'warranty')
) AS f(question, answer, embedding, category)
WHERE c.business_phone = '+19545550300';

COMMIT;
