# Phase 3: Core Services Layer

## What's Been Done

✅ **PropertyService** - Full property management
- `searchProperties()` — Find available properties by region, dates, guest count, budget, amenities
- `getPropertyDetails()` — Get complete property information
- `checkAvailability()` — Verify real-time availability for date range
- `getAvailabilityAndPricing()` — Calculate pricing including dynamic pricing overrides

✅ **BookingService** - Reservation management
- `createBooking()` — Complete booking creation with:
  - Property availability verification
  - Automatic calendar blocking (marks dates unavailable)
  - Customer booking count update
  - Transaction support (atomic operations)
  - Unique confirmation code generation
- `getBookingByConfirmationCode()` — Lookup existing bookings
- `getCustomerBookings()` — Retrieve customer's booking history
- `cancelBooking()` — Cancel with automatic calendar cleanup

✅ **CustomerService** - Customer profile management
- `getByEmail()` — Find customer by email
- `getById()` — Find customer by ID
- `createCustomer()` — Create new customer with validation
- `updateCustomer()` — Modify customer information
- `getCustomerProfile()` — Get customer with recent bookings
- `getOrCreateCustomer()` — Idempotent customer lookup/creation

✅ **CallLogService** - Call tracking and analytics
- `createCallLog()` — Initialize call log for tracking
- `logInteraction()` — Store each message in conversation
- `endCall()` — Finalize call with metrics, escalation info, transcript
- `getCallTranscript()` — Retrieve full message history for debugging
- `getCallStats()` — Analytics by date range

## Service Architecture

```
┌─────────────────────────────────────────┐
│        AI Agent / Voice Handler          │
└────────────────┬────────────────────────┘
                 │
    ┌────────────┼────────────┬────────────────┐
    ↓            ↓            ↓                ↓
┌────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐
│ Property   │ │ Booking  │ │ Customer     │ │ CallLog      │
│ Service    │ │ Service  │ │ Service      │ │ Service      │
└────┬───────┘ └────┬─────┘ └──────┬───────┘ └──────────────┘
     │              │              │
     └──────────────┼──────────────┘
                    ↓
        ┌───────────────────────┐
        │  Database (Queries)   │
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │   PostgreSQL Tables   │
        └───────────────────────┘
```

## Key Features

### PropertyService
**Search with Multiple Filters:**
```typescript
const results = await PropertyService.searchProperties({
  region: 'Cancun',
  checkInDate: '2025-03-15',
  checkOutDate: '2025-03-22',
  guestCount: 8,
  maxBudgetPerNight: 350,
  minBedrooms: 3,
  amenities: ['pool', 'ocean_view']
});
```

**Real-time Availability:**
- Queries `property_availability` table to exclude booked dates
- Supports dynamic pricing per date
- Filters only active properties

**Pricing Calculation:**
- Base price per night
- Dynamic overrides from calendar
- 7% automatic fee calculation
- Total with breakdown

### BookingService
**Transactional Booking Creation:**
- Verifies availability before proceeding
- Creates booking record with calculated pricing
- Marks dates as unavailable in calendar
- Updates customer booking count
- Generates unique confirmation code (NVH-YYYY-XXXXX)
- All-or-nothing transaction (atomic)

**Cancellation:**
- Cancels booking atomically
- Frees up calendar dates
- Updates availability reason
- Decrements booking count

### CustomerService
**Smart Customer Handling:**
- Lookup by email or ID
- Create with validation (prevents duplicates)
- Get full profile with recent bookings
- `getOrCreateCustomer()` — idempotent for voice flow (don't know if customer exists)

**Data Captured:**
- Contact info (email, phone)
- Address (city, state, country, postal code)
- Booking history and preferences
- Preferred region for recommendations

### CallLogService
**Complete Call Tracking:**
- Unique call ID per conversation
- Per-message logging (user, assistant, system)
- Tool invocation tracking with params and results
- Call duration and escalation reason
- Properties shown during call
- Full transcript for debugging

**Analytics:**
- Total calls by date range
- Escalation rate
- Booking conversion rate (bookings / calls)
- Average call duration

## Database Interactions

### PropertyService Queries
```sql
-- Search with availability
SELECT p.* FROM properties p
WHERE p.region = 'Cancun'
  AND p.max_guests >= 8
  AND NOT EXISTS (
    SELECT 1 FROM property_availability pa
    WHERE pa.property_id = p.id
      AND pa.date BETWEEN '2025-03-15' AND '2025-03-22'
      AND pa.is_available = false
  );

-- Check pricing
SELECT AVG(COALESCE(price_override, base_price_per_night))
FROM property_availability
WHERE property_id = 123
  AND date BETWEEN '2025-03-15' AND '2025-03-22';
```

### BookingService Transactions
```sql
BEGIN;
  INSERT INTO bookings (...);
  INSERT INTO property_availability (property_id, date, is_available) VALUES (123, '2025-03-15', false);
  UPDATE customers SET total_bookings = total_bookings + 1 WHERE id = 456;
COMMIT;
```

### CallLogService
```sql
-- Log interaction
INSERT INTO agent_interactions (call_id, role, message, tool_called, tool_params);

-- End call with stats
UPDATE call_logs
SET duration_seconds, escalated, escalation_reason, properties_shown, transcript
WHERE call_id = 'call_12345';
```

## Error Handling

All services include:
- Try/catch with error logging
- Meaningful error messages
- Transaction rollback on failure
- Prevents partial state updates

**Example:**
```typescript
try {
  const booking = await BookingService.createBooking(params);
} catch (error) {
  // If property becomes unavailable mid-booking:
  // "Property is not available for the selected dates"
  // Transaction automatically rolled back
  // Database state remains consistent
}
```

## Usage in Agent

When integrated with the AI agent:

```typescript
// User: "Book Casa Azul for March 15-22 for 8 people"

// 1. Search to show options
const properties = await PropertyService.searchProperties({
  region: 'Cancun',
  checkInDate: '2025-03-15',
  checkOutDate: '2025-03-22',
  guestCount: 8
});

// 2. Get pricing when customer selects
const pricing = await PropertyService.getAvailabilityAndPricing(123, '2025-03-15', '2025-03-22');

// 3. Get/create customer
const customer = await CustomerService.getOrCreateCustomer(
  'john@example.com',
  'John',
  'Smith'
);

// 4. Create booking
const booking = await BookingService.createBooking({
  propertyId: 123,
  customerId: customer.id,
  checkInDate: '2025-03-15',
  checkOutDate: '2025-03-22',
  guestCount: 8,
  totalPrice: 2250,
  specialRequests: 'High chair needed'
});

// 5. Log call
await CallLogService.endCall(
  'call_123',
  durationSeconds: 480,
  escalated: false,
  propertiesShown: [123],
  transcript: fullConversation
);
```

## Next Steps

**Phase 4 - Agent Tools & State Machine:**
- Implement agent-callable versions of these services
- Tool definitions with JSON schemas
- State machine for conversation flow
- Decision engine for complex logic

These services are now ready to be wrapped as LLM-callable tools.
