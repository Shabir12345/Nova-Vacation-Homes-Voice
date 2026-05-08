# Nova Vacation Homes - AI Voice Agent

## Project Overview
Building an AI voice agent to handle incoming calls for Nova Vacation Homes. The agent books vacation rental properties across North America, manages customer inquiries, handles reservations, and coordinates with the client's operations team.

**Key Business Logic:**
- Inbound call handling (customers calling to book or inquire about properties)
- Property recommendations based on customer needs and availability
- Reservation/booking management
- Payment processing coordination
- Customer information capture
- Escalation to human agents when needed

---

## Architecture Philosophy

### Core Principles
1. **Conversation State Management** — Complex call flows require robust state tracking across multiple conversation branches. Use explicit state machines or workflow orchestration.
2. **Intent Classification** — Early, accurate classification of caller intent drives routing decisions. Use classification models or LLM-based intent routing.
3. **Context Preservation** — Maintain conversation history, customer info, property details, and business rules throughout the call.
4. **Graceful Degradation** — When uncertain, escalate to human rather than making wrong bookings or commitments.
5. **Audit Trail** — Log all call decisions, customer data, and business transactions for compliance and improvement.

---

## Technology Stack

### Voice Infrastructure
- **Twilio** or **Vapi** — voice API for call handling, recording, and transcription
- **OpenAI Realtime API** or **Claude API** — real-time speech-to-text and agent decision making
- Consider latency for natural conversation flow

### Backend
- **Node.js / Python** — depending on real-time requirements and integrations
- **PostgreSQL** — customer data, bookings, call logs
- **Redis** — session state, rate limiting, temporary conversation context
- **Message Queue** (Bull, RabbitMQ) — async operations (confirmation emails, CRM sync)

### Agent Logic
- **LLM for decision making** — use Claude or GPT-4 with tool use for structured outputs
- **Tool definitions** — search properties, check availability, create bookings, capture customer info
- **Prompt engineering** — clear instructions for handling edge cases, tone, and business constraints

### Monitoring & Analytics
- **Logging** — Pino or Winston for structured logs
- **Call metrics** — success rate, booking conversion, escalation rate, avg call duration
- **Error tracking** — Sentry for failures and edge cases

---

## Project Structure

```
nova-vacation-homes/
├── CLAUDE.md                          # This file
├── docs/
│   ├── architecture.md                # Detailed system design
│   ├── call-flows.md                  # Customer conversation paths
│   ├── api-integration.md             # External system integrations
│   └── deployment.md                  # Production setup
├── src/
│   ├── agent/
│   │   ├── prompts.ts                 # System prompts and instructions
│   │   ├── tools.ts                   # Tool definitions (book, search, etc)
│   │   ├── state-machine.ts           # Call state management
│   │   └── decision-engine.ts         # Complex logic routing
│   ├── services/
│   │   ├── voice-service.ts           # Twilio/Vapi wrapper
│   │   ├── property-service.ts        # Property database & search
│   │   ├── booking-service.ts         # Reservation management
│   │   ├── customer-service.ts        # Customer profile & history
│   │   └── external-api.ts            # 3rd party integrations
│   ├── middleware/
│   │   ├── auth.ts                    # Call validation, security
│   │   ├── logging.ts                 # Structured call logging
│   │   └── error-handling.ts          # Graceful failures
│   ├── db/
│   │   ├── migrations/                # Schema changes
│   │   ├── models/                    # Data models
│   │   └── seeds/                     # Test data
│   └── index.ts                       # Entry point
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/                      # Mock call data, customers
├── scripts/
│   ├── setup-db.sh
│   ├── seed-properties.sh
│   └── test-call.sh                   # Manual testing
└── env-example                        # Environment variables template
```

---

## Key Decisions (To Make Early)

### 1. Real-Time vs Batch Processing
- **Real-time (preferred)** — agent responds during the call, decisions made instantly
- **Hybrid** — agent handles simple cases, complex cases queued for review

### 2. LLM Integration
- **Synchronous API calls** — simple, tight integration, adds latency (200-500ms per turn)
- **Streaming responses** — faster perceived response, complex to implement
- **Cached prompts** — leverage prompt caching for business rules, property catalogs

### 3. Booking Confirmation
- **Agent completes booking** — faster, higher risk of errors
- **Agent collects info, human approves** — slower, safer
- **Hybrid** — agent books, human async verification

### 4. Customer Data
- **Full CRM integration** — enrich calls with history, preferences
- **Anonymous first call** — collect data only if booking proceeds
- **Hybrid** — check existing customer, create new if needed

---

## Call Flow Overview

```
Incoming Call
    ↓
[Voice Recognition + Transcription]
    ↓
[Intent Classification]
    ├→ New Booking Request
    │   ├→ Collect dates, guest count, budget
    │   ├→ Search available properties
    │   ├→ Present options
    │   ├→ Collect customer details
    │   └→ Book or escalate
    │
    ├→ Existing Booking Question
    │   ├→ Find booking by name/email
    │   ├→ Answer questions
    │   └→ Modify or escalate
    │
    ├→ Billing/Payment Issue
    │   ├→ Verify customer identity
    │   ├→ Address issue or escalate
    │   └→ Confirm resolution
    │
    └→ Other / Unclear
        └→ Escalate to human
    ↓
[Call End / Escalation / Booking Confirmation]
```

---

## Critical Implementation Details

### 1. Conversation Prompting
The system prompt needs:
- Clear role definition (helpful property booking assistant)
- Business constraints (only book available properties, pricing rules, cancellation policies)
- Tone and personality (Amy: friendly, professional, proactive, and efficient)
- Escalation thresholds (when to transfer to human)
- Format requirements (clear confirmations before booking)

### 2. Tool Use Pattern
Define tools as structured functions the agent can call:
- `searchProperties(dates, guestCount, budget, region)` → available properties
- `checkAvailability(propertyId, dates)` → true/false + pricing
- `getCustomerHistory(email)` → past bookings, preferences
- `createBooking(propertyId, dates, customerInfo)` → confirmation
- `escalateToHuman(reason)` → transfers to live agent

### 3. State Machine
Track the call in distinct states:
- `GREETING` → collect intent
- `GATHERING_REQUIREMENTS` → understand needs
- `SEARCHING` → find properties
- `PRESENTING` → show options
- `COLLECTING_DETAILS` → name, email, phone, special requests
- `CONFIRMING` → summary of booking, price, cancellation policy
- `BOOKING` → execute reservation
- `CLOSED` → confirmation sent, call ends

### 4. Error Handling
- **Property Not Available** → suggest alternatives automatically
- **Customer Not Found** → create new customer record
- **Payment Issue** → escalate, don't attempt retry loop
- **LLM Uncertainty** → ask customer to clarify rather than guess
- **System Error** → graceful message to customer, escalate, log for review

### 5. Compliance & Data
- Record all calls (check local regulations)
- Encrypt sensitive data (credit cards, SSNs) — never store directly
- GDPR/PIPEDA compliance for international calls
- Clear opt-out and recording consent

---

## Getting Started Checklist

- [ ] Set up database schema (customers, properties, bookings, call_logs)
- [ ] Define property catalog structure and load test data
- [ ] Create voice infrastructure (Twilio/Vapi account, test number)
- [ ] Build initial LLM prompts and tools
- [ ] Implement basic state machine
- [ ] Create mock property search and booking flows
- [ ] Set up logging and monitoring
- [ ] Build human escalation flow
- [ ] Create test harness for call simulation
- [ ] Deploy to staging and run live tests
- [ ] Iterate based on real call data

---

## Environment Variables

Create `.env` with:
```
OPENAI_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
DATABASE_URL=
REDIS_URL=
NODE_ENV=development
LOG_LEVEL=debug
```

---

## Communication & Updates
This is a high-complexity project with many moving parts. Approach it as an expert would:
1. **Start with call flows** — map out realistic conversation paths before coding
2. **Test early with mock calls** — simulate customer interactions
3. **Iterate the prompt** — small changes to system instructions have huge impact
4. **Monitor real calls closely** — watch for failure patterns and iterate
5. **Human-in-the-loop** — review escalations and edge cases to improve agent
