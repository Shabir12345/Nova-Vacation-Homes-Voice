# Nova Vacation Homes - AI Voice Agent

Building an intelligent voice agent that handles incoming calls for Nova Vacation Homes' vacation rental booking business.

## Quick Start

1. **Read the documentation:**
   - `CLAUDE.md` — Project overview, architecture philosophy, getting started checklist
   - `docs/architecture.md` — System design and component details
   - `docs/call-flows.md` — Realistic customer conversation paths
   - `docs/api-integration.md` — Tool definitions and agent prompts

2. **Next steps:**
   - [ ] Define property catalog and database schema
   - [ ] Set up voice infrastructure (Twilio/Vapi)
   - [ ] Build LLM prompt and tool definitions
   - [ ] Create state machine for call orchestration
   - [ ] Implement property search service
   - [ ] Build booking confirmation flow
   - [ ] Set up logging and monitoring
   - [ ] Create test harness for call simulation

## Project Structure

```
nova-vacation-homes/
├── CLAUDE.md                  # Project overview & philosophy
├── README.md                  # This file
├── docs/
│   ├── architecture.md        # System design
│   ├── call-flows.md          # Customer conversation examples
│   └── api-integration.md     # Tool definitions & prompts
├── src/                       # Source code (to be built)
├── tests/                     # Test suite (to be built)
└── scripts/                   # Utilities (to be built)
```

## Key Concepts

### State Machine
The agent moves through conversation states:
- GREETING → INTENT_CLASSIFICATION → GATHERING_INFO → SEARCHING → PRESENTING → COLLECTING_DETAILS → CONFIRMING → BOOKING → CLOSED

### Tool-Based Interaction
The agent calls structured tools to interact with business systems:
- `searchProperties` — find available homes
- `getPropertyDetails` — full property info
- `checkAvailability` — verify availability
- `getCustomerByEmail` — lookup customer history
- `createCustomer` — new customer record
- `createBooking` — complete reservation
- `escalateToHuman` — transfer to human agent

### Escalation
The agent escalates to human when:
- Uncertain about intent
- Modifying existing bookings
- Payment issues
- Customer frustration
- System errors

## Tech Stack (Recommended)

- **Voice:** Twilio or Vapi
- **LLM:** Claude (Anthropic) or GPT-4 (OpenAI)
- **Backend:** Node.js or Python
- **Database:** PostgreSQL
- **Cache:** Redis
- **Queue:** Bull or RabbitMQ
- **Monitoring:** Structured logging, Sentry, custom metrics

## Critical Success Factors

1. **State Management** — Track conversation context precisely
2. **Graceful Degradation** — Always prefer escalation over wrong booking
3. **Real-Time Availability** — Property catalog must be current
4. **Prompt Iteration** — Small prompt changes = big impact on performance
5. **Monitoring** — Track every call, learn from failures
6. **Human Oversight** — Review escalations and edge cases to improve agent

## Contact

This project is for Nova Vacation Homes. Working with: [client contact info to be added]

---

**Status:** Foundation complete. Ready to start implementation.
