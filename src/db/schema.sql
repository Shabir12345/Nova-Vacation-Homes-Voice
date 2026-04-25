-- Nova Vacation Homes Database Schema

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  total_bookings INT DEFAULT 0,
  preferred_region VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customers_email ON customers(email);

-- Properties table
CREATE TABLE IF NOT EXISTS properties (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  region VARCHAR(100) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  bedrooms INT NOT NULL,
  bathrooms INT NOT NULL,
  max_guests INT NOT NULL,
  base_price_per_night NUMERIC(10, 2) NOT NULL,
  description TEXT,
  house_rules JSONB,
  amenities JSONB,
  cancellation_policy JSONB,
  images JSONB,
  rating NUMERIC(3, 2),
  total_reviews INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_properties_region ON properties(region);
CREATE INDEX idx_properties_active ON properties(is_active);

-- Property availability calendar
CREATE TABLE IF NOT EXISTS property_availability (
  id SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  price_override NUMERIC(10, 2),
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(property_id, date)
);

CREATE INDEX idx_availability_property_date ON property_availability(property_id, date);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  confirmation_code VARCHAR(50) UNIQUE NOT NULL,
  property_id INT NOT NULL REFERENCES properties(id),
  customer_id INT NOT NULL REFERENCES customers(id),
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  guest_count INT NOT NULL,
  total_nights INT NOT NULL,
  price_per_night NUMERIC(10, 2) NOT NULL,
  subtotal NUMERIC(10, 2) NOT NULL,
  fees NUMERIC(10, 2) DEFAULT 0,
  total_price NUMERIC(10, 2) NOT NULL,
  special_requests TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  payment_status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TIMESTAMP
);

CREATE INDEX idx_bookings_customer ON bookings(customer_id);
CREATE INDEX idx_bookings_property ON bookings(property_id);
CREATE INDEX idx_bookings_confirmation ON bookings(confirmation_code);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Call logs table (for tracking and analytics)
CREATE TABLE IF NOT EXISTS call_logs (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(20),
  incoming BOOLEAN DEFAULT TRUE,
  intent VARCHAR(100),
  customer_id INT REFERENCES customers(id),
  booking_id INT REFERENCES bookings(id),
  duration_seconds INT,
  escalated BOOLEAN DEFAULT FALSE,
  escalation_reason VARCHAR(255),
  properties_shown JSONB,
  transcript TEXT,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP
);

CREATE INDEX idx_call_logs_phone ON call_logs(phone_number);
CREATE INDEX idx_call_logs_customer ON call_logs(customer_id);
CREATE INDEX idx_call_logs_created ON call_logs(created_at);

-- Agent interactions log (detailed conversation history)
CREATE TABLE IF NOT EXISTS agent_interactions (
  id SERIAL PRIMARY KEY,
  call_id VARCHAR(255) NOT NULL REFERENCES call_logs(call_id),
  role VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  tool_called VARCHAR(100),
  tool_params JSONB,
  tool_result JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_interactions_call ON agent_interactions(call_id);

-- Reviews table (optional, for future use)
CREATE TABLE IF NOT EXISTS reviews (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id),
  customer_id INT NOT NULL REFERENCES customers(id),
  property_id INT NOT NULL REFERENCES properties(id),
  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title VARCHAR(255),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_reviews_property ON reviews(property_id);
CREATE INDEX idx_reviews_customer ON reviews(customer_id);

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable JSON functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
