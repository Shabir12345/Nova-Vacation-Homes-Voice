// Agent orchestrator — manages the full lifecycle of a voice call.
// Sessions are stored in Redis so state survives restarts and scales horizontally.

import { ConversationContext, StateMachine } from './state-machine';
import { processTurn, TurnResult } from './decision-engine';
import { SessionStore } from '../utils/session-store';
import { CallLogService } from '../services/calllog.service';
import { getGreeting } from './prompts';
import { logger } from '../utils/logger';

// Track calls currently being processed (for graceful shutdown drain)
const inFlightCalls = new Set<string>();

export const AgentOrchestrator = {
  startSession: async (callId: string, phoneNumber?: string): Promise<ConversationContext> => {
    const ctx = StateMachine.initialize(callId);

    await SessionStore.set(callId, ctx);

    CallLogService.createCallLog({ callId, phoneNumber })
      .catch((err) => logger.warn(err, 'Failed to create call log'));

    logger.info({ callId, phoneNumber }, 'Session started');
    return ctx;
  },

  // Returns the agent's opening line — called once at the start of the call
  getGreeting: async (callId: string): Promise<string> => {
    const ctx = await SessionStore.get(callId);
    const language = ctx?.language ?? 'en';
    return getGreeting(language);
  },

  // Process one message from the caller and return the agent's response
  handleMessage: async (callId: string, userMessage: string): Promise<TurnResult> => {
    const ctx = await SessionStore.get(callId);
    if (!ctx) {
      throw new Error(`No session found for call ${callId}. Was startSession called?`);
    }

    if (ctx.state === 'CLOSED' || ctx.state === 'ESCALATED') {
      return { context: ctx, agentResponse: '', escalated: ctx.state === 'ESCALATED' };
    }

    inFlightCalls.add(callId);
    try {
      const result = await processTurn(ctx, userMessage);
      await SessionStore.set(callId, result.context);
      return result;
    } finally {
      inFlightCalls.delete(callId);
    }
  },

  // Finalise the call — flush logs and clean up session
  endSession: async (callId: string, errorMessage?: string): Promise<void> => {
    const ctx = await SessionStore.get(callId);
    if (!ctx) return;

    const duration = StateMachine.callDurationSeconds(ctx);
    const transcript = ctx.messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    await CallLogService.endCall(
      callId,
      duration,
      ctx.state === 'ESCALATED',
      ctx.escalationReason ?? undefined,
      [], // propertiesShown — not applicable in this architecture
      transcript,
      errorMessage
    ).catch((err) => logger.warn(err, 'Failed to finalise call log'));

    await SessionStore.delete(callId);
    logger.info({ callId, duration, finalState: ctx.state }, 'Session ended');
  },

  getSession: async (callId: string): Promise<ConversationContext | null> =>
    SessionStore.get(callId),

  // Used by graceful shutdown — resolves when all in-flight calls finish
  drainActiveCalls: async (timeoutMs = 30_000): Promise<void> => {
    if (inFlightCalls.size === 0) return;

    logger.info({ activeCalls: inFlightCalls.size }, 'Draining in-flight calls before shutdown');

    const deadline = Date.now() + timeoutMs;
    while (inFlightCalls.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }

    if (inFlightCalls.size > 0) {
      logger.warn({ remaining: inFlightCalls.size }, 'Shutdown timeout reached — abandoning remaining calls');
    } else {
      logger.info('All calls drained — clean shutdown');
    }
  },
};
