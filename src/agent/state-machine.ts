// Conversation state machine — tracks exactly where we are in the call flow
// and what information has been collected so far

export type CallState =
  | 'GREETING'
  | 'INTENT_CLASSIFICATION'
  | 'GATHERING_INFO'
  | 'SEARCHING'
  | 'PRESENTING'
  | 'COLLECTING_DETAILS'
  | 'CONFIRMING'
  | 'BOOKING'
  | 'CLOSED'
  | 'ESCALATED';

export type CallIntent =
  | 'new_booking'
  | 'existing_booking'
  | 'support'
  | 'unknown';

export interface BookingSummary {
  propertyId: number;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guestCount: number;
  pricePerNight: number;
  totalPrice: number;
  cancellationPolicy?: string;
  specialRequests?: string;
}

export interface ConversationContext {
  callId: string;
  state: CallState;
  intent: CallIntent;

  // Customer info gathered during call
  customerEmail: string | null;
  customerFirstName: string | null;
  customerLastName: string | null;
  customerPhone: string | null;
  customerId: number | null;

  // Search criteria
  region: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  guestCount: number | null;
  budget: number | null;

  // Booking in progress
  selectedPropertyId: number | null;
  pendingBookingSummary: BookingSummary | null;
  confirmedBookingCode: string | null;

  // Properties shown this call (for logging)
  propertiesShown: number[];

  // Conversation messages for LLM context
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;

  // Meta
  escalationReason: string | null;
  startedAt: Date;
  clarificationAttempts: number;
}

// Valid state transitions — enforces call flow logic
const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  GREETING: ['INTENT_CLASSIFICATION', 'ESCALATED'],
  INTENT_CLASSIFICATION: ['GATHERING_INFO', 'ESCALATED'],
  GATHERING_INFO: ['SEARCHING', 'ESCALATED'],
  SEARCHING: ['PRESENTING', 'GATHERING_INFO', 'ESCALATED'],
  PRESENTING: ['COLLECTING_DETAILS', 'GATHERING_INFO', 'ESCALATED'],
  COLLECTING_DETAILS: ['CONFIRMING', 'ESCALATED'],
  CONFIRMING: ['BOOKING', 'GATHERING_INFO', 'ESCALATED'],
  BOOKING: ['CLOSED', 'ESCALATED'],
  CLOSED: [],
  ESCALATED: [],
};

export const StateMachine = {
  initialize: (callId: string): ConversationContext => ({
    callId,
    state: 'GREETING',
    intent: 'unknown',

    customerEmail: null,
    customerFirstName: null,
    customerLastName: null,
    customerPhone: null,
    customerId: null,

    region: null,
    checkInDate: null,
    checkOutDate: null,
    guestCount: null,
    budget: null,

    selectedPropertyId: null,
    pendingBookingSummary: null,
    confirmedBookingCode: null,

    propertiesShown: [],
    messages: [],

    escalationReason: null,
    startedAt: new Date(),
    clarificationAttempts: 0,
  }),

  transition: (
    context: ConversationContext,
    newState: CallState
  ): ConversationContext => {
    const allowed = VALID_TRANSITIONS[context.state];
    if (!allowed.includes(newState)) {
      // Allow transition anyway but log the anomaly
      console.warn(
        `Unexpected state transition: ${context.state} → ${newState}`
      );
    }
    return { ...context, state: newState };
  },

  addMessage: (
    context: ConversationContext,
    role: 'user' | 'assistant',
    content: string
  ): ConversationContext => ({
    ...context,
    messages: [...context.messages, { role, content }],
  }),

  updateCustomerInfo: (
    context: ConversationContext,
    updates: Partial<Pick<
      ConversationContext,
      'customerEmail' | 'customerFirstName' | 'customerLastName' |
      'customerPhone' | 'customerId'
    >>
  ): ConversationContext => ({ ...context, ...updates }),

  updateSearchCriteria: (
    context: ConversationContext,
    updates: Partial<Pick<
      ConversationContext,
      'region' | 'checkInDate' | 'checkOutDate' | 'guestCount' | 'budget'
    >>
  ): ConversationContext => ({ ...context, ...updates }),

  setSelectedProperty: (
    context: ConversationContext,
    propertyId: number,
    summary: BookingSummary
  ): ConversationContext => ({
    ...context,
    selectedPropertyId: propertyId,
    pendingBookingSummary: summary,
    propertiesShown: context.propertiesShown.includes(propertyId)
      ? context.propertiesShown
      : [...context.propertiesShown, propertyId],
  }),

  trackPropertyShown: (
    context: ConversationContext,
    propertyIds: number[]
  ): ConversationContext => ({
    ...context,
    propertiesShown: [
      ...new Set([...context.propertiesShown, ...propertyIds]),
    ],
  }),

  confirmBooking: (
    context: ConversationContext,
    confirmationCode: string
  ): ConversationContext => ({
    ...context,
    confirmedBookingCode: confirmationCode,
    state: 'CLOSED',
  }),

  escalate: (
    context: ConversationContext,
    reason: string
  ): ConversationContext => ({
    ...context,
    state: 'ESCALATED',
    escalationReason: reason,
  }),

  // Returns what info is still missing for booking
  getMissingInfo: (context: ConversationContext): string[] => {
    const missing: string[] = [];
    if (!context.region) missing.push('destination');
    if (!context.checkInDate) missing.push('check-in date');
    if (!context.checkOutDate) missing.push('check-out date');
    if (!context.guestCount) missing.push('number of guests');
    return missing;
  },

  getMissingCustomerInfo: (context: ConversationContext): string[] => {
    const missing: string[] = [];
    if (!context.customerFirstName) missing.push('first name');
    if (!context.customerLastName) missing.push('last name');
    if (!context.customerEmail) missing.push('email address');
    if (!context.customerPhone) missing.push('phone number');
    return missing;
  },

  isReadyToSearch: (context: ConversationContext): boolean =>
    !!(context.region && context.checkInDate && context.checkOutDate && context.guestCount),

  isReadyToBook: (context: ConversationContext): boolean =>
    !!(
      context.selectedPropertyId &&
      context.customerId &&
      context.checkInDate &&
      context.checkOutDate &&
      context.guestCount &&
      context.pendingBookingSummary
    ),

  callDurationSeconds: (context: ConversationContext): number =>
    Math.round((Date.now() - context.startedAt.getTime()) / 1000),
};
