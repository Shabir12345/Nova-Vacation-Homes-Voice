-- Nova Vacation Homes — Our Tables
-- (Client's property/reservation data lives in their own DB — see ClientDbService)

-- Customers: basic contact info captured during calls
CREATE TABLE IF NOT EXISTS customers (
  id          SERIAL PRIMARY KEY,
  email       VARCHAR(255) UNIQUE,
  first_name  VARCHAR(100),
  last_name   VARCHAR(100),
  phone       VARCHAR(20),
  language    VARCHAR(5) DEFAULT 'en',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

-- Call logs: one row per call
CREATE TABLE IF NOT EXISTS call_logs (
  id                 SERIAL PRIMARY KEY,
  call_id            VARCHAR(255) UNIQUE NOT NULL,
  phone_number       VARCHAR(20),
  language           VARCHAR(5) DEFAULT 'en',
  top_intent         VARCHAR(50),
  sub_intent         VARCHAR(50),
  active_agent       VARCHAR(20),         -- master | reservation | service
  customer_id        INT REFERENCES customers(id),
  intake_id          INT,                 -- FK to intake_messages.id (set after logging)
  service_request_id INT,                 -- FK to service_requests.id (set after logging)
  duration_seconds   INT,
  escalated          BOOLEAN DEFAULT FALSE,
  escalation_reason  VARCHAR(255),
  transcript         TEXT,
  error_message      TEXT,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at           TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_call_logs_phone    ON call_logs(phone_number);
CREATE INDEX IF NOT EXISTS idx_call_logs_intent   ON call_logs(top_intent);
CREATE INDEX IF NOT EXISTS idx_call_logs_created  ON call_logs(created_at);

-- Agent interactions: every message + tool call in a call
CREATE TABLE IF NOT EXISTS agent_interactions (
  id          SERIAL PRIMARY KEY,
  call_id     VARCHAR(255) NOT NULL REFERENCES call_logs(call_id),
  role        VARCHAR(20) NOT NULL,         -- user | assistant | system
  message     TEXT NOT NULL,
  tool_called VARCHAR(100),
  tool_params JSONB,
  tool_result JSONB,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interactions_call ON agent_interactions(call_id);

-- Intake messages: all inbound leads and business inquiries for staff follow-up
CREATE TABLE IF NOT EXISTS intake_messages (
  id             SERIAL PRIMARY KEY,
  call_id        VARCHAR(255) REFERENCES call_logs(call_id),
  intake_type    VARCHAR(50) NOT NULL,   -- business_inquiry | reservation_interest | extension_request
  caller_name    VARCHAR(255),
  caller_phone   VARCHAR(20),
  caller_email   VARCHAR(255),
  reason         TEXT,
  -- Future guest reservation interest fields
  destination    VARCHAR(255),
  check_in_date  VARCHAR(50),
  check_out_date VARCHAR(50),
  guest_count    INT,
  budget         VARCHAR(100),
  special_notes  TEXT,
  -- Business inquiry fields
  inquiry_type   VARCHAR(50),
  -- Status for staff workflow
  status         VARCHAR(30) DEFAULT 'pending',  -- pending | in_progress | resolved
  assigned_to    VARCHAR(100),
  resolved_at    TIMESTAMP,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_intake_status  ON intake_messages(status);
CREATE INDEX IF NOT EXISTS idx_intake_type    ON intake_messages(intake_type);
CREATE INDEX IF NOT EXISTS idx_intake_created ON intake_messages(created_at);

-- Service requests: cleaning, maintenance, and additional services
CREATE TABLE IF NOT EXISTS service_requests (
  id               SERIAL PRIMARY KEY,
  call_id          VARCHAR(255) REFERENCES call_logs(call_id),
  reservation_id   VARCHAR(255) NOT NULL,  -- FK to client's reservation in their DB
  request_type     VARCHAR(30) NOT NULL,   -- cleaning | maintenance | services
  sub_type         VARCHAR(50),            -- plumbing | ac | pool_heater | rental_grill | etc.
  description      TEXT,
  urgency          VARCHAR(20),            -- low | medium | high | emergency
  preferred_time   VARCHAR(100),
  caller_phone     VARCHAR(20),
  status           VARCHAR(30) DEFAULT 'pending',  -- pending | in_progress | resolved
  assigned_to      VARCHAR(100),
  resolved_at      TIMESTAMP,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_reservation ON service_requests(reservation_id);
CREATE INDEX IF NOT EXISTS idx_service_status      ON service_requests(status);
CREATE INDEX IF NOT EXISTS idx_service_urgency     ON service_requests(urgency);
CREATE INDEX IF NOT EXISTS idx_service_created     ON service_requests(created_at);

-- FAQ: knowledge base for general information callers
CREATE TABLE IF NOT EXISTS faqs (
  id          SERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  category    VARCHAR(100),               -- booking | policies | amenities | check-in | etc.
  language    VARCHAR(5) DEFAULT 'en',
  keywords    TEXT[],                     -- for keyword-based search
  active      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faq_category ON faqs(category);
CREATE INDEX IF NOT EXISTS idx_faq_language ON faqs(language);
CREATE INDEX IF NOT EXISTS idx_faq_active   ON faqs(active);
