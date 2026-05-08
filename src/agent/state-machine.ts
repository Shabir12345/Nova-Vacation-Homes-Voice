// Conversation state machine — tracks call flow across all 4 branches
// Matches the flowchart: Business Inquiry, General Info, Future Guest, Reservation (existing)

import { config } from '../config';
import { logger } from '../utils/logger';

export type CallState =
  // Universal
  | 'GREETING'
  | 'INTENT_CLASSIFICATION'
  // Branch 1: Business Inquiry
  | 'BUSINESS_INQUIRY_COLLECTING'
  | 'BUSINESS_INQUIRY_LOGGED'
  // Branch 2: General Information (FAQ)
  | 'GENERAL_INFO_ANSWERING'
  // Branch 3: Future Guest
  | 'FUTURE_GUEST_ROUTING'          // decide: make reservation OR general info
  | 'FUTURE_GUEST_RESERVATION'      // collecting details for staff callback
  | 'FUTURE_GUEST_INFO'             // answering via DB, collecting basic details
  // Branch 4: Existing Guest (Reservation)
  | 'VERIFYING_RESERVATION'         // confirm booking via DB
  | 'EXISTING_GUEST_ROUTING'        // decide: reservation agent OR service agent
  // Reservation sub-agent
  | 'RESERVATION_AGENT'
  // Service sub-agent
  | 'SERVICE_AGENT'
  // Terminal states
  | 'CLOSED'
  | 'ESCALATED';

export type CallIntent =
  | 'business_inquiry'
  | 'general_information'
  | 'future_guest'
  | 'existing_guest'
  | 'unknown';

export type ExistingGuestIntent =
  | 'general_information'
  | 'listing_information'
  | 'check_in_check_out'
  | 'extend_reservation'
  | 'cleaning'
  | 'maintenance'
  | 'services'
  | 'unknown';

export type FutureGuestIntent =
  | 'make_reservation'
  | 'general_information'
  | 'unknown';

export type ActiveAgent = 'master' | 'reservation' | 'service';

export type Language = 'en' | 'es' | 'pt';

export interface IntakeMessage {
  callerName: string | null;
  callerPhone: string | null;
  callerEmail: string | null;
  reason: string | null;
  additionalNotes: string | null;
}

export interface ReservationDetails {
  reservationId: string | null;
  guestName: string | null;
  propertyName: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  confirmed: boolean;
}

export interface ServiceRequest {
  type: 'cleaning' | 'maintenance' | 'services' | null;
  subType: string | null; // plumbing, ac, pool_heater, rental_grill, etc.
  description: string | null;
  urgency: 'low' | 'medium' | 'high' | null;
}

export interface ConversationContext {
  callId: string;
  state: CallState;
  activeAgent: ActiveAgent;

  // Intent at each level
  topIntent: CallIntent;
  futureGuestIntent: FutureGuestIntent;
  existingGuestIntent: ExistingGuestIntent;

  // Language detected
  language: Language;

  // Caller identity
  callerName: string | null;
  callerPhone: string | null;
  callerEmail: string | null;

  // Existing guest data (populated via DB lookup)
  reservation: ReservationDetails;

  // For intake branches (business inquiry, future guest reservation)
  intakeMessage: IntakeMessage;

  // For service agent branch
  serviceRequest: ServiceRequest;

  // Conversation history for LLM
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;

  // Meta
  escalationReason: string | null;
  startedAt: Date;
  clarificationAttempts: number;
  isBusinessHours: boolean;
}

// Enforce valid transitions per the call flow diagram
const VALID_TRANSITIONS: Record<CallState, CallState[]> = {
  GREETING:                     ['INTENT_CLASSIFICATION', 'ESCALATED'],
  INTENT_CLASSIFICATION:        ['BUSINESS_INQUIRY_COLLECTING', 'GENERAL_INFO_ANSWERING', 'FUTURE_GUEST_ROUTING', 'VERIFYING_RESERVATION', 'ESCALATED'],
  BUSINESS_INQUIRY_COLLECTING:  ['BUSINESS_INQUIRY_LOGGED', 'ESCALATED'],
  BUSINESS_INQUIRY_LOGGED:      ['CLOSED'],
  GENERAL_INFO_ANSWERING:       ['CLOSED', 'INTENT_CLASSIFICATION', 'ESCALATED'],
  FUTURE_GUEST_ROUTING:         ['FUTURE_GUEST_RESERVATION', 'FUTURE_GUEST_INFO', 'ESCALATED'],
  FUTURE_GUEST_RESERVATION:     ['CLOSED', 'ESCALATED'],
  FUTURE_GUEST_INFO:            ['CLOSED', 'FUTURE_GUEST_ROUTING', 'ESCALATED'],
  VERIFYING_RESERVATION:        ['EXISTING_GUEST_ROUTING', 'ESCALATED'],
  EXISTING_GUEST_ROUTING:       ['RESERVATION_AGENT', 'SERVICE_AGENT', 'ESCALATED'],
  RESERVATION_AGENT:            ['CLOSED', 'EXISTING_GUEST_ROUTING', 'ESCALATED'],
  SERVICE_AGENT:                ['CLOSED', 'EXISTING_GUEST_ROUTING', 'ESCALATED'],
  CLOSED:                       [],
  ESCALATED:                    [],
};

const isBusinessHoursNow = (): boolean => {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: config.BUSINESS_TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  const hour = parseInt(formatted, 10);
  return hour >= config.BUSINESS_HOURS_OPEN && hour < config.BUSINESS_HOURS_CLOSE;
};

const emptyReservation = (): ReservationDetails => ({
  reservationId: null,
  guestName: null,
  propertyName: null,
  checkInDate: null,
  checkOutDate: null,
  confirmed: false,
});

const emptyIntake = (): IntakeMessage => ({
  callerName: null,
  callerPhone: null,
  callerEmail: null,
  reason: null,
  additionalNotes: null,
});

const emptyServiceRequest = (): ServiceRequest => ({
  type: null,
  subType: null,
  description: null,
  urgency: null,
});

export const StateMachine = {
  initialize: (callId: string): ConversationContext => ({
    callId,
    state: 'GREETING',
    activeAgent: 'master',

    topIntent: 'unknown',
    futureGuestIntent: 'unknown',
    existingGuestIntent: 'unknown',

    language: 'en',

    callerName: null,
    callerPhone: null,
    callerEmail: null,

    reservation: emptyReservation(),
    intakeMessage: emptyIntake(),
    serviceRequest: emptyServiceRequest(),

    messages: [],

    escalationReason: null,
    startedAt: new Date(),
    clarificationAttempts: 0,
    isBusinessHours: isBusinessHoursNow(),
  }),

  transition: (ctx: ConversationContext, newState: CallState): ConversationContext => {
    const allowed = VALID_TRANSITIONS[ctx.state];
    if (!allowed.includes(newState)) {
      logger.warn({ from: ctx.state, to: newState }, 'Unexpected state transition');
    }
    return { ...ctx, state: newState };
  },

  addMessage: (
    ctx: ConversationContext,
    role: 'user' | 'assistant',
    content: string
  ): ConversationContext => ({
    ...ctx,
    messages: [...ctx.messages, { role, content }],
  }),

  setIntent: (
    ctx: ConversationContext,
    intent: CallIntent
  ): ConversationContext => ({
    ...ctx,
    topIntent: intent,
    activeAgent: intent === 'existing_guest' ? 'master' : 'master',
  }),

  setExistingGuestIntent: (
    ctx: ConversationContext,
    intent: ExistingGuestIntent
  ): ConversationContext => {
    const isServiceIntent = ['cleaning', 'maintenance', 'services'].includes(intent);
    return {
      ...ctx,
      existingGuestIntent: intent,
      activeAgent: isServiceIntent ? 'service' : 'reservation',
      state: isServiceIntent ? 'SERVICE_AGENT' : 'RESERVATION_AGENT',
    };
  },

  setFutureGuestIntent: (
    ctx: ConversationContext,
    intent: FutureGuestIntent
  ): ConversationContext => ({
    ...ctx,
    futureGuestIntent: intent,
    state: intent === 'make_reservation' ? 'FUTURE_GUEST_RESERVATION' : 'FUTURE_GUEST_INFO',
  }),

  setLanguage: (ctx: ConversationContext, language: Language): ConversationContext => ({
    ...ctx,
    language,
  }),

  setCallerInfo: (
    ctx: ConversationContext,
    updates: Partial<Pick<ConversationContext, 'callerName' | 'callerPhone' | 'callerEmail'>>
  ): ConversationContext => ({ ...ctx, ...updates }),

  setReservation: (
    ctx: ConversationContext,
    reservation: Partial<ReservationDetails>
  ): ConversationContext => ({
    ...ctx,
    reservation: { ...ctx.reservation, ...reservation },
  }),

  updateIntake: (
    ctx: ConversationContext,
    updates: Partial<IntakeMessage>
  ): ConversationContext => ({
    ...ctx,
    intakeMessage: { ...ctx.intakeMessage, ...updates },
  }),

  updateServiceRequest: (
    ctx: ConversationContext,
    updates: Partial<ServiceRequest>
  ): ConversationContext => ({
    ...ctx,
    serviceRequest: { ...ctx.serviceRequest, ...updates },
  }),

  escalate: (ctx: ConversationContext, reason: string): ConversationContext => ({
    ...ctx,
    state: 'ESCALATED',
    escalationReason: reason,
  }),

  close: (ctx: ConversationContext): ConversationContext => ({
    ...ctx,
    state: 'CLOSED',
  }),

  incrementClarificationAttempts: (ctx: ConversationContext): ConversationContext => ({
    ...ctx,
    clarificationAttempts: ctx.clarificationAttempts + 1,
  }),

  callDurationSeconds: (ctx: ConversationContext): number =>
    Math.round((Date.now() - ctx.startedAt.getTime()) / 1000),

  getMissingIntakeFields: (ctx: ConversationContext): string[] => {
    const missing: string[] = [];
    if (!ctx.callerName && !ctx.intakeMessage.callerName) missing.push('name');
    if (!ctx.callerPhone && !ctx.intakeMessage.callerPhone) missing.push('phone number');
    if (!ctx.intakeMessage.reason) missing.push('reason for calling');
    return missing;
  },
};
