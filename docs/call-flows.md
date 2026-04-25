# Call Flow Scenarios - Nova Vacation Homes

These are realistic customer conversation flows that the AI agent must handle. Each shows the agent's state, decision points, and potential branches.

---

## Flow 1: New Booking - Happy Path

```
Customer: "Hi, I'm looking to book a vacation home"

Agent State: GREETING
Agent: "Hi! Welcome to Nova Vacation Homes. I'm excited to help you find the perfect 
         property. Are you looking to book a home for an upcoming trip?"

Customer: "Yes, we're planning a trip to Cancun for Spring Break. We need something 
           for 8 people, March 15-22"

Agent State: GATHERING_INFO
Agent Decision: Extract dates, region (Cancun), guest count (8)
Agent: "Perfect! Spring Break in Cancun - that's going to be great. So 8 guests, 
        March 15th to 22nd? Got it. What's your budget range per night?"

Customer: "We're thinking around $250-350 per night"

Agent State: GATHERING_INFO (complete)
Agent Decision: Call searchProperties(region="Cancun", checkIn="2025-03-15", 
                checkOut="2025-03-22", guests=8, budget=350)
Agent: "Let me search our available properties for you..."

[1-2 second wait while searching]

Agent State: PRESENTING_OPTIONS
Search Result: Returns 5 properties matching criteria
Agent: "Great news! I found several options for you. Here are my top 3 recommendations:

  1. Casa Azul - Sleeps 8, $300/night, beachfront with pool and hot tub
  2. Villa Paraiso - Sleeps 10, $280/night, ocean view, 2 kitchens, great for groups
  3. Playa Blanca - Sleeps 8, $320/night, private beach access, modern amenities
  
Would any of these interest you?"

Customer: "Villa Paraiso sounds perfect. Tell me more about it"

Agent State: PRESENTING_OPTIONS
Agent Decision: Call getPropertyDetails(propertyId=456)
Agent: "Excellent choice! Villa Paraiso is one of our guests' favorites. It has:
  - 4 bedrooms, 3 full bathrooms
  - Two full kitchens (great for large groups)
  - Ocean view from the master suite
  - Pool and hot tub
  - Private beach access
  - Concierge available 24/7
  
The total for your stay (7 nights) would be $1,960, plus $150 in fees, 
so $2,110 total. Does that work for you?"

Customer: "Sounds good! Let's book it"

Agent State: COLLECTING_DETAILS
Agent: "Perfect! I just need to collect your information to complete the reservation.
        What's your full name?"

Customer: "John Smith"

Agent: "Great, John. And your email address?"

Customer: "john.smith@email.com"

Agent: "And a phone number where we can reach you?"

Customer: "555-123-4567"

Agent: "Any special requests? Bed preferences, dietary restrictions for the concierge?"

Customer: "Just make sure we have a crib for our 1-year-old"

Agent State: CONFIRMING
Agent: "Let me recap everything:
  
  Property: Villa Paraiso, Cancun
  Check-in: March 15, 2025 (3 PM)
  Check-out: March 22, 2025 (11 AM)
  Guest count: 8 (1 infant)
  Total price: $2,110
  Cancellation: Free cancellation up to 7 days before arrival
  Special request: Crib for infant
  
  Does this all look correct?"

Customer: "Yes, perfect!"

Agent State: BOOKING
Agent Decision: Call createBooking(...) - succeeds
Booking ID: BK-20250102-9847
Agent: "Excellent! Your reservation is confirmed. Your confirmation number is 
        BK-20250102-9847. You'll receive a confirmation email at john.smith@email.com 
        in just a moment with all the details, house rules, check-in instructions, 
        and the concierge contact number.
        
        Is there anything else I can help you with before we finish?"

Customer: "No, that's all. Thanks!"

Agent State: CLOSED
Agent: "Perfect, John! Have an amazing Spring Break in Cancun. We'll see you 
        March 15th! Thank you for choosing Nova Vacation Homes."

[Call ends]
```

---

## Flow 2: Budget Constraint - Agent Adapts

```
Customer: "Hi, I want to book a place in Miami for this weekend. 3 people, 
           Saturday to Sunday"

Agent State: GATHERING_INFO
Agent: "Hi there! Miami is wonderful. So that's 3 guests, this Saturday and Sunday? 
        Great. What's your budget per night?"

Customer: "Um... ideally under $100 per night?"

Agent State: GATHERING_INFO
Agent Decision: Low budget for Miami on short notice. Might not have matches, 
                but search anyway
Search Result: Only 2 properties match (usually $120-150 range)

Agent: "I'll be honest - Miami on a Saturday night is pretty busy, and I found 
        most places are running $120-150 right now. I did find two options:
        
  1. Beachside Studio - $95/night, sleeps 2 + 1 on sofa bed
  2. Inland Bungalow - $110/night (just slightly over), but more space
        
Or... would you be open to looking at nearby areas like Coral Gables or Homestead? 
They're 30-40 minutes away but have plenty under $100."

Customer: "Actually, I'm flexible. Show me what you have around $150"

Agent State: GATHERING_INFO (revised)
Agent: "Perfect! With a bit more flexibility, I have much better options:
  
  1. Ocean Breeze Condo - $135/night, oceanfront, sleeps 4
  2. Sunset Villa - $150/night, pool, garden, great reviews
  3. Modern Loft - $140/night, downtown location
        
Which of these sounds better?"

Customer: "The Sunset Villa is perfect. Let's go with that"

[Continue to COLLECTING_DETAILS → CONFIRMING → BOOKING as before]
```

---

## Flow 3: Escalation - Existing Booking Question

```
Customer: "Hi, I have an existing reservation and I need to ask about early check-in"

Agent State: GREETING
Agent: "Hi! I'd be happy to help with your existing reservation. 
        Can I have the email address associated with your booking?"

Customer: "sarah.jones@email.com"

Agent State: GATHERING_INFO
Agent Decision: Call getCustomerByEmail("sarah.jones@email.com") 
                Finds 1 existing booking: Property Casa Blanca, March 20-27
Agent: "Great! I found your reservation at Casa Blanca for March 20-27. 
        You're asking about early check-in on March 20th?"

Customer: "Actually, we'd like to come on March 19th instead. Is that possible?"

Agent State: GATHERING_INFO
Agent Decision: Early check-in is a change to existing booking. Requires:
  - Verify availability of property for March 19-20
  - Calculate price difference
  - This is complex - escalate to human for approval

Agent: "I can help with that! Let me check a couple things... [pause]
        
        The property is available on March 19th. This is a modification to your 
        existing booking, so I want to get you connected with one of our booking 
        specialists who can handle the date change and any pricing adjustments 
        right away. Just a moment..."

Agent State: ESCALATE
Agent Decision: Call escalateToHuman(reason="existing_booking_modification", 
                callState="early_checkin_request")
Agent: "[Connected to human agent]"

Human Agent: "Hi Sarah, I see you want to move your check-in up to March 19th..."
```

---

## Flow 4: Agent Uncertainty → Escalation

```
Customer: "Hi, I'm looking for a property in... um... where exactly would you 
           recommend for someone who likes skiing and also wants warm beaches?"

Agent State: GREETING
Agent: "That's a fun question! So you're looking for skiing AND beaches? 
        That's a unique combo. Are you thinking of a single location, 
        or are you planning two separate trips?"

Customer: "I don't know, what makes sense? We have 2 weeks. We like the 
          family-friendly vibe but also want to party with friends"

Agent State: INTENT_CLASSIFICATION
Agent Decision: Customer needs = conflicting preferences (skiing vs beach, 
                family vs party, 2 weeks unstructured)
                This is beyond simple property search. Best handled by human 
                who can understand full context and offer personalized advice.

Agent: "That's a great question and honestly, there are a lot of fun possibilities 
        here - it depends on what time of year, your budget, and how you want to 
        split the time. This is one of those situations where I think you'd really 
        benefit from talking to one of our travel specialists who can create a 
        custom multi-destination itinerary for you.
        
        Let me connect you with someone who specializes in this kind of planning."

Agent State: ESCALATE
Agent Decision: Call escalateToHuman(reason="complex_planning_request", 
                callState="needs_specialist")
[Transfer to human specialist]
```

---

## Flow 5: Payment Issue → Escalation

```
Customer: "I'm ready to book, but I need to use a different credit card than 
           the one you have on file"

Agent State: CONFIRMING
Agent: "No problem! Let me just process your booking with the new card. 
        However, for security reasons, I'm not able to take payment information 
        over the phone during this call. 
        
        Here's what I'll do: I'll prepare your reservation and connect you with 
        our payment specialist who can securely process your new card, and your 
        booking will be instantly confirmed. One moment..."

Agent State: ESCALATE → PAYMENT_SPECIALIST
Agent Decision: Call escalateToHuman(reason="payment_method_change", 
                callState="ready_to_book")
Agent: "[Connected to payment specialist]"

Payment Specialist: "Hi, I see you're ready to book Villa Paraiso and need to 
                    update your payment method. I can help with that securely..."
```

---

## Flow 6: Availability Conflict → Agent Recovers

```
Customer: "I want to book the property I saw listed for $200/night"

Agent State: GATHERING_INFO  
Agent: "Great! Do you remember the name of the property, or what region 
        it was in?"

Customer: "It was in Key West, beachfront"

Agent State: GATHERING_INFO
Agent: "Perfect, Key West is beautiful. When would you like to book?"

Customer: "March 10-15"

Agent Decision: Call checkAvailability(propertyId from previous search, dates)
Result: Property is no longer available (booked by another customer in the time 
        since the customer last viewed it)

Agent: "I'm sorry, it looks like that specific property was just booked by 
        another guest in the last few minutes. But I have great news - I have 
        two other beachfront properties in Key West that are the same price 
        or less, and they're available for those exact dates.
        
        Would you like to see those alternatives?"

Customer: "Yes, please"

Agent State: PRESENTING_OPTIONS (recovery)
Agent: "Here are two fantastic alternatives:
  1. Sunset Retreat - $200/night, beachfront, 2BR
  2. Ocean Breeze - $195/night, beachfront with pool, 2BR
        
Which would you like to hear more about?"

[Continues to booking path]
```

---

## Flow 7: Confused Intent → Clarification

```
Customer: "Hey, I'm calling about my thing"

Agent State: GREETING
Agent: "Hi there! Thanks for calling Nova Vacation Homes. I'm here to help. 
        Are you calling about:
  - Booking a new vacation property?
  - Questions about an existing reservation?
  - Something else?
        
What can I help you with?"

Customer: "Uh, the second one I think"

Agent State: INTENT_CLASSIFICATION → Clarified to EXISTING_BOOKING
Agent: "Got it! You have an existing reservation. Can I have the email 
        address that's on your booking?"

Customer: "It's mike123@hotmail.com"

[Continue from there...]
```

---

## Key Decision Points Across All Flows

1. **Is intent clear?** If not → ask clarifying questions
2. **Do available properties match request?** If not → offer alternatives (different dates, budget, region)
3. **Is customer data complete?** If not → ask missing fields
4. **Is this a booking, modification, or support question?** Route accordingly
5. **Is the agent confident enough to proceed?** If not → escalate
6. **Should we ask for confirmation before booking?** Always → recap all details
7. **Did something break?** → graceful escalation with context

---

## Escalation Reasons (Escalate to Human)

| Reason | Trigger | Action |
|--------|---------|--------|
| `existing_booking_change` | Customer wants to modify dates/guests of existing booking | Human handles rebooking |
| `payment_issue` | Payment fails, customer prefers different method | Payment specialist handles securely |
| `unclear_intent` | Customer request is ambiguous or complex | Specialist understands full context |
| `high_value_booking` | Large group or long stay | Human reviews for special deals |
| `customer_distress` | Customer upset or frustrated | Human handles with empathy |
| `system_error` | Database error, property unavailable | Human has workarounds |
| `special_request` | Customer needs accommodations beyond standard | Human coordinates with property |

