-- Seed data for development and testing

-- Sample properties
INSERT INTO properties (
  name, region, address, city, state, country, postal_code,
  bedrooms, bathrooms, max_guests, base_price_per_night, description,
  house_rules, amenities, cancellation_policy, is_active
) VALUES
(
  'Casa Azul - Cancun',
  'Cancun',
  'Paseo Kukulkan 45',
  'Cancun',
  'Quintana Roo',
  'Mexico',
  '77500',
  3, 2, 8,
  300.00,
  'Beautiful beachfront villa with ocean views, pool, and hot tub',
  '{"checkInTime": "3:00 PM", "checkOutTime": "11:00 AM", "smokingAllowed": false, "petsAllowed": false}',
  '["pool", "ocean_view", "concierge", "wifi", "kitchen"]',
  '{"type": "flexible", "description": "Free cancellation up to 7 days before arrival", "refundPercentage": 100}',
  TRUE
),
(
  'Villa Paraiso - Cancun',
  'Cancun',
  'Boulevard Barrera 123',
  'Cancun',
  'Quintana Roo',
  'Mexico',
  '77500',
  4, 3, 10,
  280.00,
  'Luxury ocean view villa with 2 kitchens, perfect for large groups',
  '{"checkInTime": "3:00 PM", "checkOutTime": "11:00 AM", "smokingAllowed": false, "petsAllowed": false}',
  '["pool", "ocean_view", "2_kitchens", "beach_access", "concierge", "wifi"]',
  '{"type": "moderate", "description": "Free cancellation up to 14 days before arrival", "refundPercentage": 100}',
  TRUE
),
(
  'Playa Blanca - Cancun',
  'Cancun',
  'Avenida Tulum 500',
  'Cancun',
  'Quintana Roo',
  'Mexico',
  '77500',
  3, 2, 8,
  320.00,
  'Modern beachfront property with private beach access and hot tub',
  '{"checkInTime": "3:00 PM", "checkOutTime": "11:00 AM", "smokingAllowed": false, "petsAllowed": false}',
  '["private_beach", "hot_tub", "modern_decor", "ocean_view", "wifi"]',
  '{"type": "strict", "description": "Free cancellation up to 3 days before arrival", "refundPercentage": 100}',
  TRUE
),
(
  'Beachside Studio - Miami',
  'Miami',
  'Ocean Drive 1500',
  'Miami',
  'Florida',
  'USA',
  '33139',
  1, 1, 3,
  95.00,
  'Cozy beachfront studio perfect for couples or solo travelers',
  '{"checkInTime": "4:00 PM", "checkOutTime": "10:00 AM", "smokingAllowed": false, "petsAllowed": false}',
  '["beach_access", "ocean_view", "kitchenette", "wifi"]',
  '{"type": "flexible", "description": "Free cancellation up to 10 days before arrival", "refundPercentage": 100}',
  TRUE
),
(
  'Sunset Villa - Miami',
  'Miami',
  'Collins Avenue 2000',
  'Miami',
  'Florida',
  'USA',
  '33139',
  3, 2, 8,
  150.00,
  'Elegant villa with pool and garden overlooking the ocean',
  '{"checkInTime": "3:00 PM", "checkOutTime": "11:00 AM", "smokingAllowed": false, "petsAllowed": true}',
  '["pool", "garden", "ocean_view", "patio", "wifi", "kitchen"]',
  '{"type": "flexible", "description": "Free cancellation up to 7 days before arrival", "refundPercentage": 100}',
  TRUE
),
(
  'Sunset Retreat - Key West',
  'Key West',
  'Duval Street 100',
  'Key West',
  'Florida',
  'USA',
  '33040',
  2, 1, 4,
  200.00,
  'Charming beachfront property with direct ocean access',
  '{"checkInTime": "3:00 PM", "checkOutTime": "11:00 AM", "smokingAllowed": false, "petsAllowed": false}',
  '["beachfront", "ocean_view", "patio", "wifi", "kitchen"]',
  '{"type": "flexible", "description": "Free cancellation up to 7 days before arrival", "refundPercentage": 100}',
  TRUE
);

-- Add availability for properties (next 30 days, all available)
INSERT INTO property_availability (property_id, date, is_available, reason)
SELECT
  p.id,
  CURRENT_DATE + (interval '1 day' * s.a),
  true,
  NULL
FROM
  properties p,
  generate_series(0, 89) AS s(a);

-- Sample customers (optional, for testing)
INSERT INTO customers (email, first_name, last_name, phone, country, preferred_region)
VALUES
  ('john.smith@example.com', 'John', 'Smith', '555-0100', 'USA', 'Cancun'),
  ('sarah.jones@example.com', 'Sarah', 'Jones', '555-0101', 'Canada', 'Miami'),
  ('michael.brown@example.com', 'Michael', 'Brown', '555-0102', 'USA', 'Key West')
ON CONFLICT (email) DO NOTHING;

-- Sample booking (optional, for testing)
INSERT INTO bookings (
  confirmation_code, property_id, customer_id, check_in_date, check_out_date,
  guest_count, total_nights, price_per_night, subtotal, fees, total_price,
  status, payment_status
)
SELECT
  'NVH-2025-0001',
  (SELECT id FROM properties WHERE name = 'Casa Azul - Cancun'),
  (SELECT id FROM customers WHERE email = 'john.smith@example.com'),
  CURRENT_DATE + interval '30 days',
  CURRENT_DATE + interval '37 days',
  4,
  7,
  300.00,
  2100.00,
  150.00,
  2250.00,
  'confirmed',
  'completed'
WHERE EXISTS (SELECT 1 FROM customers WHERE email = 'john.smith@example.com')
AND EXISTS (SELECT 1 FROM properties WHERE name = 'Casa Azul - Cancun')
ON CONFLICT DO NOTHING;
