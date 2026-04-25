# API Integration & Tool Definitions

## Tool Definitions for AI Agent

These are the structured tools the AI agent can call during conversation. Each tool has a clear input/output contract.

### 1. Search Properties

**Purpose:** Find available properties based on customer criteria

**Function:** `searchProperties`

**Input Schema:**
```json
{
  "region": "string (required)",
  "checkInDate": "YYYY-MM-DD (required)",
  "checkOutDate": "YYYY-MM-DD (required)",
  "guestCount": "integer 1-20 (required)",
  "maxBudgetPerNight": "float (optional, default: unlimited)",
  "minBedrooms": "integer (optional)",
  "amenities": ["string array] (optional, e.g. ['pool', 'hot_tub', 'kitchen'])"
}
```

**Output Schema:**
```json
{
  "success": true,
  "properties": [
    {
      "id": "prop_123",
      "name": "Casa Azul",
      "region": "Cancun",
      "pricePerNight": 300,
      "bedrooms": 3,
      "bathrooms": 2,
      "maxGuests": 8,
      "amenities": ["pool", "ocean_view", "concierge"],
      "cancellationPolicy": "free_cancellation_7_days",
      "imageUrl": "https://...",
      "rating": 4.8
    }
  ],
  "totalFound": 23
}
```

**Error Cases:**
- No properties found → return empty array, suggest alternatives
- Invalid dates → return error with explanation
- Region not covered → return error, list available regions

---

### 2. Get Property Details

**Purpose:** Get full details for a specific property

**Function:** `getPropertyDetails`

**Input Schema:**
```json
{
  "propertyId": "string (required)",
  "checkInDate": "YYYY-MM-DD (optional, for pricing)",
  "checkOutDate": "YYYY-MM-DD (optional, for pricing)"
}
```

**Output Schema:**
```json
{
  "success": true,
  "property": {
    "id": "prop_123",
    "name": "Casa Azul",
    "region": "Cancun",
    "address": "Paseo Kukulkan, Cancun",
    "bedrooms": 3,
    "bathrooms": 2,
    "maxGuests": 8,
    "basePrice": 300,
    "currentPrice": 320,
    "pricingReason": "Spring Break premium",
    "amenities": {
      "outdoor": ["pool", "hot_tub", "beach_access"],
      "indoor": ["kitchen", "washing_machine", "wifi"],
      "services": ["concierge", "housekeeping"]
    },
    "houseRules": {
      "checkInTime": "3:00 PM",
      "checkOutTime": "11:00 AM",
      "petsAllowed": false,
      "smoking": false,
      "parties": false,
      "maxOccupancy": 10
    },
    "cancellationPolicy": {
      "type": "flexible",
      "description": "Free cancellation up to 7 days before arrival",
      "refundPercentage": 100
    },
    "description": "Beautiful beachfront villa with ocean views...",
    "images": ["url1", "url2", "url3"],
    "reviews": [
      {
        "author": "John D.",
        "rating": 5,
        "text": "Amazing property, great location!"
      }
    ]
  }
}
```

---

### 3. Check Availability

**Purpose:** Verify real-time availability for specific dates

**Function:** `checkAvailability`

**Input Schema:**
```json
{
  "propertyId": "string (required)",
  "checkInDate": "YYYY-MM-DD (required)",
  "checkOutDate": "YYYY-MM-DD (required)"
}
```

**Output Schema:**
```json
{
  "available": true,
  "propertyId": "prop_123",
  "checkInDate": "2025-03-15",
  "checkOutDate": "2025-03-22",
  "nights": 7,
  "pricePerNight": 300,
  "subtotal": 2100,
  "fees": 150,
  "totalPrice": 2250,
  "currency": "USD"
}
```

**Error Cases:**
- Property not available → return false with reason
- Dates invalid → return error
- Inventory system down → escalate

---

### 4. Get Customer by Email

**Purpose:** Look up existing customer to retrieve history and preferences

**Function:** `getCustomerByEmail`

**Input Schema:**
```json
{
  "email": "string (required, valid email)"
}
```

**Output Schema (if found):**
```json
{
  "found": true,
  "customer": {
    "id": "cust_456",
    "email": "john@example.com",
    "firstName": "John",
    "lastName": "Smith",
    "phone": "555-123-4567",
    "totalBookings": 3,
    "memberSince": "2023-05-10",
    "preferredRegion": "Cancun",
    "recentBookings": [
      {
        "id": "bk_789",
        "propertyName": "Casa Azul",
        "checkIn": "2024-12-20",
        "checkOut": "2024-12-27"
      }
    ]
  }
}
```

**Output (if not found):**
```json
{
  "found": false,
  "email": "john@example.com"
}
```

---

### 5. Create Customer

**Purpose:** Create new customer record for first-time booker

**Function:** `createCustomer`

**Input Schema:**
```json
{
  "email": "string (required, unique)",
  "firstName": "string (required)",
  "lastName": "string (required)",
  "phone": "string (required)",
  "address": "string (optional)",
  "specialRequests": "string (optional)"
}
```

**Output Schema:**
```json
{
  "success": true,
  "customer": {
    "id": "cust_789",
    "email": "john@example.com",
    "firstName": "John",
    "phone": "555-123-4567"
  }
}
```

**Error Cases:**
- Email already exists → return conflict error
- Missing required field → return validation error
- Database error → escalate

---

### 6. Create Booking

**Purpose:** Create a reservation for customer

**Function:** `createBooking`

**Input Schema:**
```json
{
  "propertyId": "string (required)",
  "customerId": "string (required)",
  "checkInDate": "YYYY-MM-DD (required)",
  "checkOutDate": "YYYY-MM-DD (required)",
  "guestCount": "integer (required)",
  "totalPrice": "float (required, must match real-time calculation)",
  "specialRequests": "string (optional)",
  "source": "string (voice_agent)"
}
```

**Output Schema (success):**
```json
{
  "success": true,
  "booking": {
    "id": "bk_20250301_5847",
    "confirmationCode": "NVH-2025-5847",
    "propertyId": "prop_123",
    "propertyName": "Casa Azul",
    "customerId": "cust_789",
    "checkInDate": "2025-03-15",
    "checkOutDate": "2025-03-22",
    "nights": 7,
    "guestCount": 8,
    "totalPrice": 2250,
    "status": "confirmed",
    "checkInInstructions": "Use keypad code 1234...",
    "conciergePhone": "+52-555-123-4567",
    "confirmationEmailSent": true,
    "createdAt": "2025-03-01T15:32:00Z"
  }
}
```

**Output (error):**
```json
{
  "success": false,
  "error": {
    "code": "PROPERTY_UNAVAILABLE",
    "message": "Property became unavailable during booking process",
    "retryable": true
  }
}
```

**Critical Notes:**
- Price must match real-time check or booking fails (prevents overbooking/underbooking)
- Booking is atomic - either fully succeeds or fails (no partial bookings)
- Confirmation email sent immediately if booking succeeds
- If booking fails after customer sees confirmation, escalate immediately

---

### 7. Get Booking by Confirmation Code

**Purpose:** Retrieve existing booking details

**Function:** `getBookingByConfirmationCode`

**Input Schema:**
```json
{
  "confirmationCode": "string (required)"
}
```

**Output Schema:**
```json
{
  "found": true,
  "booking": {
    "id": "bk_20250301_5847",
    "confirmationCode": "NVH-2025-5847",
    "propertyName": "Casa Azul",
    "checkInDate": "2025-03-15",
    "checkOutDate": "2025-03-22",
    "guestCount": 8,
    "totalPrice": 2250,
    "status": "confirmed",
    "cancellationDeadline": "2025-03-08"
  }
}
```

---

### 8. Escalate to Human

**Purpose:** Transfer call to human agent

**Function:** `escalateToHuman`

**Input Schema:**
```json
{
  "reason": "string (required, predefined reason code)",
  "summary": "string (short context for human agent)",
  "preserveContext": true
}
```

**Reason Codes:**
- `payment_issue`
- `existing_booking_modification`
- `unclear_intent`
- `customer_distress`
- `system_error`
- `high_value_booking`
- `special_accommodations`

**Output Schema:**
```json
{
  "success": true,
  "message": "Transferring to human agent...",
  "estimatedWaitTime": "1-2 minutes",
  "agentAssigned": "Sarah M."
}
```

---

## System Prompt Structure

The agent's system prompt should include:

1. **Role Definition**
   - "You are a helpful, friendly AI assistant for Nova Vacation Homes"
   - "Your goal is to help customers find and book vacation properties"

2. **Business Rules**
   - "Only book properties that are confirmed available"
   - "Always recap the booking before completing"
   - "Free cancellation policies: always explain clearly"
   - "Pricing is dynamic; always quote current price"

3. **Conversation Guidelines**
   - "Be warm and helpful, not robotic"
   - "If customer seems frustrated, offer to escalate"
   - "Don't make assumptions; ask clarifying questions"
   - "Confirm all details before booking"

4. **Tool Guidance**
   - "When to search properties: after collecting dates, guest count, budget"
   - "When to create booking: only after customer explicitly agrees and details confirmed"
   - "When to escalate: if uncertain or customer requests human assistance"

5. **Escalation Thresholds**
   - If property availability changes during conversation → re-verify before booking
   - If customer hesitates 3+ times → offer escalation
   - If anything fails → escalate immediately with error details
   - If customer gets frustrated → offer human agent proactively

---

## Error Handling Strategy

| Error Type | Agent Response | Action |
|-----------|----------------|--------|
| Property unavailable | "Let me find alternatives..." | Search again, suggest similar properties |
| Payment processing | "Let me connect you with our payment specialist..." | Escalate immediately |
| Database error | "I'm having trouble retrieving that information..." | Escalate with context |
| Missing customer info | "I need your email to proceed, please" | Ask specifically for field |
| Invalid input | "I didn't catch that, could you repeat?" | Ask customer to rephrase |

