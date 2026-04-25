// Decision engine — routes each turn to the correct agent (master/reservation/service),
// executes tool calls, and advances conversation state

import Anthropic from '@anthropic-ai/sdk';
import { ConversationContext, StateMachine } from './state-machine';
import {
  masterAgentTools,
  reservationAgentTools,
  serviceAgentTools,
  executeTool,
} from './tools';
import {
  masterAgentPrompt,
  reservationAgentPrompt,
  serviceAgentPrompt,
  buildContextNotes,
} from './prompts';
import { CallLogService } from '../services/calllog.service';
import { logger } from '../utils/logger';

const client = new Anthropic();

export interface TurnResult {
  context: ConversationContext;
  agentResponse: string;
  escalated: boolean;
}

// Select the right tools for the active agent
const getToolsForAgent = (ctx: ConversationContext): Anthropic.Tool[] => {
  switch (ctx.activeAgent) {
    case 'reservation': return reservationAgentTools;
    case 'service':     return serviceAgentTools;
    default:            return masterAgentTools;
  }
};

// Build the correct system prompt for the active agent
const buildSystemPrompt = (ctx: ConversationContext): string => {
  const contextNotes = buildContextNotes({
    isBusinessHours: ctx.isBusinessHours,
    callerName: ctx.callerName,
    topIntent: ctx.topIntent,
    existingGuestIntent: ctx.existingGuestIntent,
    reservationId: ctx.reservation.reservationId,
    propertyName: ctx.reservation.propertyName,
  });

  const reservationDetails = ctx.reservation.confirmed
    ? `Name: ${ctx.reservation.guestName}\nProperty: ${ctx.reservation.propertyName}\n` +
      `Check-in: ${ctx.reservation.checkInDate}  Check-out: ${ctx.reservation.checkOutDate}\n` +
      `Reservation ID: ${ctx.reservation.reservationId}`
    : 'Reservation not yet verified.';

  switch (ctx.activeAgent) {
    case 'reservation':
      return reservationAgentPrompt(ctx.language, reservationDetails, contextNotes);
    case 'service':
      return serviceAgentPrompt(ctx.language, reservationDetails, contextNotes);
    default:
      return masterAgentPrompt(ctx.language, ctx.state, contextNotes);
  }
};

// Apply side effects from tool calls back to the conversation context
const applyToolSideEffects = (
  ctx: ConversationContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolData: unknown
): ConversationContext => {
  const data = toolData as Record<string, unknown>;

  switch (toolName) {
    case 'detect_language':
      return StateMachine.setLanguage(ctx, data['language'] as 'en' | 'es' | 'pt');

    case 'classify_intent': {
      const intent = data['intent'] as ConversationContext['topIntent'];
      ctx = StateMachine.setIntent(ctx, intent);
      switch (intent) {
        case 'business_inquiry':    return StateMachine.transition(ctx, 'BUSINESS_INQUIRY_COLLECTING');
        case 'general_information': return StateMachine.transition(ctx, 'GENERAL_INFO_ANSWERING');
        case 'future_guest':        return StateMachine.transition(ctx, 'FUTURE_GUEST_ROUTING');
        case 'existing_guest':      return StateMachine.transition(ctx, 'VERIFYING_RESERVATION');
        default: return ctx;
      }
    }

    case 'classify_future_guest_intent':
      return StateMachine.setFutureGuestIntent(
        ctx,
        data['intent'] as ConversationContext['futureGuestIntent']
      );

    case 'verify_reservation': {
      if (data['found']) {
        const res = data['reservation'] as Record<string, string>;
        ctx = StateMachine.setReservation(ctx, {
          reservationId: res['id'] ?? res['reservationId'],
          guestName: res['guestName'] ?? res['guest_name'],
          propertyName: res['propertyName'] ?? res['property_name'],
          checkInDate: res['checkInDate'] ?? res['check_in_date'],
          checkOutDate: res['checkOutDate'] ?? res['check_out_date'],
          confirmed: true,
        });
        return StateMachine.transition(ctx, 'EXISTING_GUEST_ROUTING');
      }
      return ctx;
    }

    case 'classify_existing_guest_intent':
      return StateMachine.setExistingGuestIntent(
        ctx,
        data['intent'] as ConversationContext['existingGuestIntent']
      );

    case 'log_business_inquiry':
      return StateMachine.transition(ctx, 'BUSINESS_INQUIRY_LOGGED');

    case 'log_reservation_interest':
    case 'log_cleaning_request':
    case 'log_maintenance_request':
    case 'log_service_request':
    case 'request_reservation_extension':
      // These are terminal actions — conversation moves toward CLOSED
      return ctx;

    default:
      return ctx;
  }
};

export const processTurn = async (
  context: ConversationContext,
  userMessage: string
): Promise<TurnResult> => {
  let ctx = StateMachine.addMessage(context, 'user', userMessage);

  await CallLogService.logInteraction({
    callId: ctx.callId,
    role: 'user',
    message: userMessage,
  }).catch((err) => logger.warn(err, 'Failed to log user message'));

  const messages: Anthropic.MessageParam[] = ctx.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let agentResponse = '';
  let escalated = false;
  let currentMessages = messages;

  // Agentic loop — keep calling until no more tool_use blocks
  let continueLoop = true;
  while (continueLoop) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: buildSystemPrompt(ctx),
      messages: currentMessages,
      tools: getToolsForAgent(ctx),
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    if (textBlocks.length > 0) {
      agentResponse = textBlocks.map((b) => b.text).join('\n');
    }

    if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);

        await CallLogService.logInteraction({
          callId: ctx.callId,
          role: 'assistant',
          message: `[Tool: ${toolUse.name}]`,
          toolCalled: toolUse.name,
          toolParams: toolUse.input as Record<string, unknown>,
          toolResult: result as Record<string, unknown>,
        }).catch((err) => logger.warn(err, 'Failed to log tool call'));

        // Apply state side effects from tool results
        if (result.success && result.data) {
          ctx = applyToolSideEffects(ctx, toolUse.name, toolUse.input as Record<string, unknown>, result.data);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.success
            ? JSON.stringify(result.data)
            : JSON.stringify({ error: result.error }),
          is_error: !result.success,
        });
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    } else {
      continueLoop = false;
    }
  }

  if (agentResponse) {
    ctx = StateMachine.addMessage(ctx, 'assistant', agentResponse);

    await CallLogService.logInteraction({
      callId: ctx.callId,
      role: 'assistant',
      message: agentResponse,
    }).catch((err) => logger.warn(err, 'Failed to log assistant message'));
  }

  return { context: ctx, agentResponse, escalated };
};
