# Phase 2: Database Schema & Models

## What's Been Done

✅ **PostgreSQL Schema Created**
- `src/db/schema.sql` — Complete schema with 7 core tables
  - `customers` — User profiles
  - `properties` — Vacation home listings
  - `property_availability` — Calendar of availability by date
  - `bookings` — Reservations
  - `call_logs` — Call history and metadata
  - `agent_interactions` — Detailed conversation transcripts
  - `reviews` — Property reviews

✅ **TypeScript Models**
- `src/db/models.ts` — Type-safe interfaces matching the schema
- All tables have corresponding TypeScript models with proper typing

✅ **Database Connection Setup**
- `src/db/connection.ts` — PostgreSQL connection pool initialization
- Pool management with connection timeout and idle handling
- Migration runner for applying schema

✅ **Query Helpers**
- `src/db/queries.ts` — Common database operations
  - `CustomerQueries` — find, create, update customers
  - `PropertyQueries` — search, filter, list properties
  - `BookingQueries` — create, find bookings
  - `CallLogQueries` — log calls and interactions
  - Error handling and logging for all queries

✅ **Test Data**
- `src/db/seeds.sql` — Sample properties, customers, and bookings
- Pre-populated with Cancun and Miami vacation homes
- 90 days of availability data

## Database Schema Overview

### customers
Stores customer information for repeat bookings and CRM

```sql
- id: int (PK)
- email: varchar UNIQUE
- first_name, last_name, phone
- address, city, state, country, postal_code
- total_bookings, preferred_region
- created_at, updated_at
```

### properties
Vacation home listings with pricing and amenities

```sql
- id: int (PK)
- name, region, address, coordinates
- bedrooms, bathrooms, max_guests
- base_price_per_night
- amenities (JSONB): ["pool", "wifi", "kitchen"]
- house_rules (JSONB): check-in/out times, pet policy, smoking
- cancellation_policy (JSONB): type, percentage, days notice
- rating, total_reviews
- is_active: boolean
```

### property_availability
Calendar-based availability tracking

```sql
- id: int (PK)
- property_id, date (composite unique)
- is_available: boolean
- price_override: optional dynamic pricing
- reason: cancellation, maintenance, etc.
```

### bookings
Reservations with status and pricing

```sql
- id: int (PK)
- confirmation_code: unique
- property_id, customer_id (FKs)
- check_in_date, check_out_date
- guest_count, total_nights
- price_per_night, subtotal, fees, total_price
- special_requests
- status: pending | confirmed | cancelled
- payment_status: pending | completed | failed
```

### call_logs
Analytics and debugging

```sql
- id: int (PK)
- call_id: unique identifier for this call
- phone_number
- intent: new_booking | existing_question | support
- customer_id, booking_id (optional FK)
- escalated: boolean
- escalation_reason
- properties_shown: JSONB array of property IDs
- transcript: full conversation text
- error_message: if call failed
- duration_seconds
```

### agent_interactions
Detailed message history for each call

```sql
- id: int (PK)
- call_id: FK to call_logs
- role: user | assistant | system
- message: text
- tool_called: which tool (if any)
- tool_params: input to tool (JSONB)
- tool_result: output from tool (JSONB)
```

## Setup Instructions

### 1. Create Local PostgreSQL Database

```bash
# macOS (Homebrew)
brew install postgresql
brew services start postgresql

# Ubuntu/Debian
sudo apt-get install postgresql
sudo systemctl start postgresql

# Windows
# Download from https://www.postgresql.org/download/windows/
```

### 2. Create Database

```bash
# Create superuser if needed
createuser -U postgres -s novaagentusr

# Create database
createdb -U novaagentusr nova_vacation_homes

# Connect to verify
psql -U novaagentusr -d nova_vacation_homes
```

### 3. Configure Environment

```bash
# Copy .env.example and update
cp .env.example .env

# Set DATABASE_URL in .env
DATABASE_URL=postgresql://novaagentusr:password@localhost:5432/nova_vacation_homes
```

### 4. Run Migrations

```bash
# Install dependencies first
npm install

# Run schema and seed data
npm run db:migrate
npm run db:seed
```

### 5. Verify

```bash
# Connect to database
psql -U novaagentusr -d nova_vacation_homes

# List tables
\dt

# Check properties
SELECT name, region, base_price_per_night FROM properties;
```

## Key Indexes

For optimal query performance:

```sql
- idx_customers_email              -- Fast customer lookup
- idx_properties_region            -- Regional property search
- idx_properties_active            -- Filter only active properties
- idx_availability_property_date   -- Calendar queries
- idx_bookings_customer            -- Customer booking history
- idx_bookings_property            -- Property booking history
- idx_bookings_status              -- Filter by booking status
- idx_call_logs_phone              -- Call history by phone
- idx_call_logs_created            -- Time-range queries
```

## Query Examples

### Search properties by region and availability
```sql
SELECT p.* FROM properties p
JOIN property_availability pa ON p.id = pa.property_id
WHERE p.region = 'Cancun'
  AND pa.date BETWEEN '2025-03-15' AND '2025-03-22'
  AND pa.is_available = true
  AND p.max_guests >= 8
  AND p.base_price_per_night <= 350
```

### Get customer booking history
```sql
SELECT b.confirmation_code, p.name, b.check_in_date, b.check_out_date
FROM bookings b
JOIN properties p ON b.property_id = p.id
WHERE b.customer_id = 1
ORDER BY b.created_at DESC
```

### Call analytics
```sql
SELECT
  DATE(created_at) as call_date,
  COUNT(*) as total_calls,
  SUM(CASE WHEN escalated THEN 1 ELSE 0 END) as escalated,
  SUM(CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END) as bookings_made
FROM call_logs
GROUP BY DATE(created_at)
ORDER BY call_date DESC
```

## Next Steps

**Phase 3 - Core Services Layer:**
- Implement PropertyService with search logic
- Implement BookingService with reservation management
- Implement CustomerService with profile management
- Implement VoiceService with call handling
- Add business logic for pricing, availability, validation

## Useful Database Commands

```bash
# Connect to database
psql -U novaagentusr -d nova_vacation_homes

# Backup database
pg_dump nova_vacation_homes > backup.sql

# Restore database
psql nova_vacation_homes < backup.sql

# Reset database (dangerous!)
dropdb nova_vacation_homes && createdb nova_vacation_homes
```
