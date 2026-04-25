// Conversation state machine for managing call flow
// States: GREETING -> INTENT_CLASSIFICATION -> GATHERING_INFO -> SEARCHING ->
//         PRESENTING -> COLLECTING_DETAILS -> CONFIRMING -> BOOKING -> CLOSED

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

export interface ConversationContext {
  callId: string;
  state: CallState;
  intent: string | null;
  customerEmail: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  guestCount: number | null;
  budget: number | null;
  region: string | null;
  propertyId: string | null;
  messages: Array<{ role: string; content: string }>;
}

export const StateMachine = {
  initialize: (): ConversationContext => ({
    callId: `call_${Date.now()}`,
    state: 'GREETING',
    intent: null,
    customerEmail: null,
    checkInDate: null,
    checkOutDate: null,
    guestCount: null,
    budget: null,
    region: null,
    propertyId: null,
    messages: [],
  }),

  transition: (context: ConversationContext, newState: CallState): ConversationContext => ({
    ...context,
    state: newState,
  }),
};
