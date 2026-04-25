// Agent orchestrator — manages the full lifecycle of a voice call
// Creates the session, processes each turn, and closes the call

import { ConversationContext, StateMachine } from './state-machine';
import { processTurn, TurnResult } from './decision-engine';
import { CallLogService } from '../services/calllog.service';
import { logger } from '../utils/logger';

export interface AgentSession {
  callId: string;
  context: ConversationContext;
  startedAt: Date;
}

// Active sessions keyed by callId — in production use Redis
const activeSessions = new Map<string, ConversationContext>();

export const AgentOrchestrator = {
  // Start a new call session
  startSession: async (callId: string, phoneNumber?: string): Promise<AgentSession> => {
    const context = StateMachine.initialize(callId);
    activeSessions.set(callId, context);

    await CallLogService.createCallLog({ callId, phoneNumber }).catch((err) =>
      logger.warn(err, 'Failed to create call log')
    );

    logger.info({ callId, phoneNumber }, 'Agent session started');
    return { callId, context, startedAt: context.startedAt };
  },

  // Process one message from the caller and return the agent's response
  handleMessage: async (callId: string, userMessage: string): Promise<TurnResult> => {
    const context = activeSessions.get(callId);
    if (!context) {
      throw new Error(`No active session for call ${callId}`);
    }

    if (context.state === 'CLOSED' || context.state === 'ESCALATED') {
      return {
        context,
        agentResponse: '',
        escalated: context.state === 'ESCALATED',
        bookingConfirmed: !!context.confirmedBookingCode,
        confirmationCode: context.confirmedBookingCode ?? undefined,
      };
    }

    const result = await processTurn(context, userMessage);
    activeSessions.set(callId, result.context);
    return result;
  },

  // Get initial greeting — called at the very start of the call
  getGreeting: async (callId: string): Promise<TurnResult> => {
    return AgentOrchestrator.handleMessage(
      callId,
      '[CALL_START] Customer has just connected.'
    );
  },

  // End a call — finalize logs and clean up session
  endSession: async (
    callId: string,
    errorMessage?: string
  ): Promise<void> => {
    const context = activeSessions.get(callId);
    if (!context) return;

    const duration = StateMachine.callDurationSeconds(context);

    await CallLogService.endCall(
      callId,
      duration,
      context.state === 'ESCALATED',
      context.escalationReason ?? undefined,
      context.propertiesShown,
      context.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n'),
      errorMessage
    ).catch((err) => logger.warn(err, 'Failed to finalize call log'));

    activeSessions.delete(callId);
    logger.info({ callId, duration, state: context.state }, 'Agent session ended');
  },

  getSession: (callId: string): ConversationContext | undefined => {
    return activeSessions.get(callId);
  },
};
