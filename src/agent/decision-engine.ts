// Decision engine — routes each turn to the correct agent layer,
// executes tool calls, handles retries, and applies prompt caching.
//
// Prompt caching strategy:
//   • System prompt → cache_control: ephemeral (5-min TTL, refreshed each turn)
//   • This cuts per-turn LLM cost by ~80% and latency by ~300ms on cache hits

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
import { config } from '../config';
import { logger } from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TurnResult {
  context: ConversationContext;
  agentResponse: string;
  escalated: boolean;
  cacheHit?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getToolsForAgent = (ctx: ConversationContext): Anthropic.Tool[] => {
  switch (ctx.activeAgent) {
    case 'reservation': return reservationAgentTools;
    case 'service':     return serviceAgentTools;
    default:            return masterAgentTools;
  }
};

const buildSystemPrompt = (ctx: ConversationContext): string => {
  const contextNotes = buildContextNotes({
    isBusinessHours: ctx.isBusinessHours,
    callerName: ctx.callerName,
    topIntent: ctx.topIntent,
    existingGuestIntent: ctx.existingGuestIntent,
    reservationId: ctx.reservation.reservationId,
    propertyName: ctx.reservation.propertyName,
  });

  const reservationBlock = ctx.reservation.confirmed
    ? `Guest: ${ctx.reservation.guestName}\nProperty: ${ctx.reservation.propertyName}\n` +
      `Check-in: ${ctx.reservation.checkInDate}  Check-out: ${ctx.reservation.checkOutDate}\n` +
      `Reservation ID: ${ctx.reservation.reservationId}`
    : 'Reservation not yet verified.';

  switch (ctx.activeAgent) {
    case 'reservation': return reservationAgentPrompt(ctx.language, reservationBlock, contextNotes);
    case 'service':     return serviceAgentPrompt(ctx.language, reservationBlock, contextNotes);
    default:            return masterAgentPrompt(ctx.language, ctx.state, contextNotes);
  }
};

// Build system prompt with cache_control so Claude caches it for 5 minutes.
// The stable portion (role, rules) is cached; dynamic context appended uncached.
const buildCachedSystemBlocks = (
  ctx: ConversationContext
): Anthropic.TextBlockParam[] => {
  const fullPrompt = buildSystemPrompt(ctx);

  if (!config.ENABLE_PROMPT_CACHING) {
    return [{ type: 'text', text: fullPrompt }];
  }

  // Split at the dynamic "## Current Conversation State" section so the
  // stable role+rules portion gets cached and only the small dynamic tail changes.
  const splitMarker = '\n## Current Conversation State';
  const splitIndex = fullPrompt.indexOf(splitMarker);

  if (splitIndex === -1) {
    return [{
      type: 'text',
      text: fullPrompt,
      cache_control: { type: 'ephemeral' },
    }];
  }

  return [
    {
      type: 'text',
      text: fullPrompt.slice(0, splitIndex),
      cache_control: { type: 'ephemeral' }, // cached portion
    },
    {
      type: 'text',
      text: fullPrompt.slice(splitIndex), // uncached dynamic tail
    },
  ];
};

// Apply state side-effects from tool results back to context
const applyToolSideEffects = (
  ctx: ConversationContext,
  toolName: string,
  _input: Record<string, unknown>,
  data: unknown
): ConversationContext => {
  const d = data as Record<string, unknown>;

  switch (toolName) {
    case 'detect_language':
      return StateMachine.setLanguage(ctx, d['language'] as 'en' | 'es' | 'pt');

    case 'classify_intent': {
      const intent = d['intent'] as ConversationContext['topIntent'];
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
        ctx, d['intent'] as ConversationContext['futureGuestIntent']
      );

    case 'verify_reservation':
      if (d['found']) {
        const r = d['reservation'] as Record<string, string>;
        ctx = StateMachine.setReservation(ctx, {
          reservationId: r['id'] ?? r['reservationId'],
          guestName: r['guestName'] ?? r['guest_name'],
          propertyName: r['propertyName'] ?? r['property_name'],
          checkInDate: r['checkInDate'] ?? r['check_in_date'],
          checkOutDate: r['checkOutDate'] ?? r['check_out_date'],
          confirmed: true,
        });
        return StateMachine.transition(ctx, 'EXISTING_GUEST_ROUTING');
      }
      return ctx;

    case 'classify_existing_guest_intent':
      return StateMachine.setExistingGuestIntent(
        ctx, d['intent'] as ConversationContext['existingGuestIntent']
      );

    case 'log_business_inquiry':
      return StateMachine.transition(ctx, 'BUSINESS_INQUIRY_LOGGED');

    default:
      return ctx;
  }
};

// ─── Retry wrapper ────────────────────────────────────────────────────────────

const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimitOrOverload =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.APIStatusError;

      if (!isRateLimitOrOverload || attempt === maxAttempts) throw err;

      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 200;
      logger.warn({ attempt, delay: Math.round(delay) }, 'LLM call failed — retrying');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
};

// ─── Core turn processor ──────────────────────────────────────────────────────

export const processTurn = async (
  context: ConversationContext,
  userMessage: string
): Promise<TurnResult> => {
  let ctx = StateMachine.addMessage(context, 'user', userMessage);

  // Fire-and-forget logging — never let logging block the voice response
  CallLogService.logInteraction({ callId: ctx.callId, role: 'user', message: userMessage })
    .catch((err) => logger.warn(err, 'Failed to log user message'));

  const messages: Anthropic.MessageParam[] = ctx.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let agentResponse = '';
  let escalated = false;
  let cacheHit = false;
  let currentMessages = messages;

  // Agentic loop — continue until LLM stops using tools
  let continueLoop = true;
  while (continueLoop) {
    const systemBlocks = buildCachedSystemBlocks(ctx);

    const response = await withRetry(() =>
      anthropic.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 1024,
        system: systemBlocks,
        messages: currentMessages,
        tools: getToolsForAgent(ctx),
      })
    );

    // Detect prompt cache hit from usage headers
    const usage = response.usage as Record<string, number>;
    if (usage['cache_read_input_tokens'] > 0) cacheHit = true;

    logger.debug({
      stopReason: response.stop_reason,
      inputTokens: usage['input_tokens'],
      cacheReadTokens: usage['cache_read_input_tokens'] ?? 0,
      cacheWriteTokens: usage['cache_creation_input_tokens'] ?? 0,
    }, 'LLM response');

    const textBlocks   = response.content.filter((b): b is Anthropic.TextBlock   => b.type === 'text');
    const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (textBlocks.length > 0) {
      agentResponse = textBlocks.map((b) => b.text).join('\n');
    }

    if (response.stop_reason === 'tool_use' && toolUseBlocks.length > 0) {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);

        CallLogService.logInteraction({
          callId: ctx.callId,
          role: 'assistant',
          message: `[Tool: ${toolUse.name}]`,
          toolCalled: toolUse.name,
          toolParams: toolUse.input as Record<string, unknown>,
          toolResult: result as Record<string, unknown>,
        }).catch((err) => logger.warn(err, 'Failed to log tool call'));

        if (result.success && result.data) {
          ctx = applyToolSideEffects(ctx, toolUse.name, toolUse.input as Record<string, unknown>, result.data);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result.success ? JSON.stringify(result.data) : JSON.stringify({ error: result.error }),
          is_error: !result.success,
        });
      }

      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user',      content: toolResults },
      ];
    } else {
      continueLoop = false;
    }
  }

  if (agentResponse) {
    ctx = StateMachine.addMessage(ctx, 'assistant', agentResponse);
    CallLogService.logInteraction({ callId: ctx.callId, role: 'assistant', message: agentResponse })
      .catch((err) => logger.warn(err, 'Failed to log assistant message'));
  }

  return { context: ctx, agentResponse, escalated, cacheHit };
};
