# System Architecture - Nova Vacation Homes Voice Agent

## High-Level Architecture

```
┌─────────────────┐
│  Incoming Call  │
│    (Twilio)     │
└────────┬────────┘
         │
         ↓
┌──────────────────────────────────────┐
│  Voice Service Layer                 │
│  - Call routing                      │
│  - Audio transcription               │
│  - Text-to-speech for agent response │
└────────┬─────────────────────────────┘
         │
         ↓
┌──────────────────────────────────────┐
│  AI Agent Core                       │
│  - State machine (GREETING → BOOKING)│
│  - Intent classification             │
│  - Conversation management           │
│  - Tool invocation                   │
└────────┬─────────────────────────────┘
         │
    ┌────┼────┬────────────┬──────────┐
    ↓    ↓    ↓            ↓          ↓
┌────────────────────────────────────────────────────────┐
│             Tool/Service Layer                         │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────┐ │
│  │ Property    │ │ Booking      │ │ Customer       │ │
│  │ Service     │ │ Service      │ │ Service        │ │
│  └──────┬──────┘ └──────┬───────┘ └────────┬───────┘ │
│         │                │                 │         │
│  ┌────────────────────────────────────────────────┐  │
│  │  PostgreSQL Database                           │  │
│  │  (Customers, Properties, Bookings, Logs)      │  │
│  └────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
         │
         ↓
┌──────────────────────────────┐
│  Observability              │
│  - Structured logging        │
│  - Metrics/telemetry         │
│  - Error tracking            │
│  - Call analytics            │
└──────────────────────────────┘
```

## Key Components

### 1. Voice Service (Twilio/Vapi Integration)
**Responsibility:** Handle inbound calls, manage audio streams, handle hangups

**Flow:**
- Receive incoming call webhook
- Create session with agent
- Stream audio to LLM real-time API
- Receive text response from agent
- Convert to speech and play
- Handle call disconnection, timeouts, DTMF (if needed)

**Considerations:**
- Latency budget: aim for < 1s response time
- Audio quality: 16kHz mono recommended
- Error handling: drop calls gracefully, never leave customer hanging

### 2. AI Agent Core (State Machine)
**Responsibility:** Orchestrate conversation, make decisions, call tools

**States:**
```
GREETING
  ↓
INTENT_CLASSIFICATION  (is this a new booking? existing booking? support?)
  ↓
GATHERING_INFO        (collect dates, guest count, budget, region)
  ↓
SEARCHING_PROPERTIES  (call search tool)
  ↓
PRESENTING_OPTIONS    (show top 3-5 properties)
  ↓
COLLECTING_DETAILS    (name, email, phone, special requests)
  ↓
CONFIRMING            (recap: property, dates, total price, cancellation policy)
  ↓
BOOKING               (attempt reservation)
  ↓
CLOSED                (confirmation, thank you, end call)

ESCALATE (any state → human agent if uncertain)
```

**Decision Points:**
- Is customer intent clear?
- Are there available properties matching criteria?
- Is customer information complete?
- Does customer want to proceed with booking?
- Are there any payment/system issues?

### 3. Tool Definitions
The agent calls tools to interact with business systems. Each tool has:
- Clear input schema (what data is required)
- Clear output schema (what the agent gets back)
- Error handling (what happens if tool fails)

**Core Tools:**
- `searchProperties(region, checkInDate, checkOutDate, guestCount, maxBudget)` 
  - Returns: list of available properties with pricing
- `getPropertyDetails(propertyId)`
  - Returns: full details, amenities, house rules, cancellation policy
- `checkAvailability(propertyId, checkInDate, checkOutDate)`
  - Returns: available or not + current pricing
- `getCustomerByEmail(email)`
  - Returns: customer record (if exists) with past bookings
- `createCustomer(name, email, phone)`
  - Returns: new customer ID
- `createBooking(propertyId, customerId, checkInDate, checkOutDate, totalPrice, specialRequests)`
  - Returns: confirmation number or error
- `escalateToHuman(reason, callState)`
  - Transfers call to human agent

### 4. Database Schema (Core Tables)

**customers**
```
id, email, phone, first_name, last_name, 
created_at, total_bookings, preferred_region
```

**properties**
```
id, name, region, address, bedrooms, bathrooms,
max_guests, base_price_per_night, amenities (json),
house_rules (json), cancellation_policy (json)
```

**bookings**
```
id, property_id, customer_id, check_in_date, check_out_date,
total_guests, total_price, special_requests, confirmation_code,
status (pending/confirmed/cancelled), created_at
```

**call_logs**
```
id, phone_number, call_duration, intent, properties_shown,
booking_id (if booked), escalated (true/false),
transcript (if storing), created_at
```

### 5. Error & Edge Cases

| Scenario | Agent Action |
|----------|--------------|
| No properties match criteria | Suggest expanding dates/budget, or escalate |
| Customer hesitant about price | Show cheaper alternatives, highlight value |
| Customer wants to modify booking | Escalate (human handles changes) |
| Payment fails | Don't retry; escalate with error details |
| Customer info incomplete | Ask directly, don't assume |
| Call drops | Log state, don't re-charge customer |
| Confused intent | Politely clarify: "Are you looking to book or have a question about an existing reservation?" |

## Integration Points

### External APIs
- **Twilio/Vapi** — incoming calls, call management
- **OpenAI/Anthropic** — LLM for agent brain
- **Payment Gateway** (Stripe?) — for payment coordination (or escalate)
- **Email Service** (SendGrid?) — confirmation emails
- **CRM** (HubSpot/Salesforce?) — customer sync (optional)

### Business System Requirements
- **Property inventory** — needs to be up-to-date, queryable by location/date/guests
- **Availability calendar** — real-time or near-real-time
- **Pricing engine** — dynamic pricing, rules, fees
- **Confirmation workflow** — how bookings are finalized (immediate vs. manual review)

---

## Scalability Considerations

1. **Call Concurrency** — design database and LLM calls to handle N simultaneous calls
2. **Property Search** — index by region, date range for fast lookups
3. **Session State** — use Redis for temporary call state (faster than DB)
4. **Rate Limiting** — prevent abuse, manage LLM API costs
5. **Failover** — what happens if LLM is down? Escalate to human immediately

---

## Testing Strategy

1. **Unit Tests** — test individual tools, state transitions
2. **Integration Tests** — test complete flows (e.g., "user calls, books property X")
3. **Call Simulation** — mock Twilio webhooks with realistic customer inputs
4. **Prompt Testing** — A/B test prompt variations for tone, accuracy, booking conversion
5. **Regression Tests** — before each deploy, run test calls to ensure no breaking changes
