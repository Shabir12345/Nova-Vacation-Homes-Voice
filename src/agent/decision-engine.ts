// Decision engine — processes LLM responses, executes tool calls,
// and advances the conversation state

import Anthropic from '@anthropic-ai/sdk';
import { ConversationContext, StateMachine } from './state-machine';
import { toolDefinitions, executeTool } from './tools';
import { systemPrompt } from './prompts';
import { CallLogService } from '../services/calllog.service';
import { logger } from '../utils/logger';

const client = new Anthropic();

export interface TurnResult {
  context: ConversationContext;
  agentResponse: string;
  escalated: boolean;
  bookingConfirmed: boolean;
  confirmationCode?: string;
}

// Process one conversation turn: send message, handle tools, return response
export const processTurn = async (
  context: ConversationContext,
  userMessage: string
): Promise<TurnResult> => {
  // Add user message to context
  let ctx = StateMachine.addMessage(context, 'user', userMessage);

  // Log user message
  await CallLogService.logInteraction({
    callId: ctx.callId,
    role: 'user',
    message: userMessage,
  }).catch((err) => logger.warn(err, 'Failed to log user message'));

  // Build messages array for the API
  const messages: Anthropic.MessageParam[] = ctx.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let agentResponse = '';
  let escalated = false;
  let bookingConfirmed = false;
  let confirmationCode: string | undefined;

  // Agentic loop: keep calling until no more tool use
  let continueLoop = true;
  let currentMessages = messages;

  while (continueLoop) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: buildSystemPromptWithContext(ctx),
      messages: currentMessages,
      tools: toolDefinitions,
    });

    logger.debug({ stopReason: response.stop_reason }, 'LLM response received');

    // Collect text from response
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
      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const result = await executeTool(toolUse.name, toolUse.input);

        // Log tool invocation
        await CallLogService.logInteraction({
          callId: ctx.callId,
          role: 'assistant',
          message: `[Tool: ${toolUse.name}]`,
          toolCalled: toolUse.name,
          toolParams: toolUse.input as Record<string, unknown>,
          toolResult: result as Record<string, unknown>,
        }).catch((err) => logger.warn(err, 'Failed to log tool call'));

        // Handle escalation immediately
        if (toolUse.name === 'escalate_to_human') {
          escalated = true;
          ctx = StateMachine.escalate(ctx, (toolUse.input as { reason: string }).reason);
        }

        // Handle booking confirmation
        if (toolUse.name === 'create_booking' && result.success) {
          const bookingData = result.data as { confirmationCode: string };
          confirmationCode = bookingData.confirmationCode;
          bookingConfirmed = true;
          ctx = StateMachine.confirmBooking(ctx, confirmationCode);
        }

        // Track properties shown
        if (toolUse.name === 'search_properties' && result.success) {
          const data = result.data as { properties: Array<{ id: number }> };
          ctx = StateMachine.trackPropertyShown(ctx, data.properties.map((p) => p.id));
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

      // Continue loop with tool results appended
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    } else {
      // No more tool calls — agent is done for this turn
      continueLoop = false;
    }
  }

  // Add assistant response to context
  if (agentResponse) {
    ctx = StateMachine.addMessage(ctx, 'assistant', agentResponse);

    await CallLogService.logInteraction({
      callId: ctx.callId,
      role: 'assistant',
      message: agentResponse,
    }).catch((err) => logger.warn(err, 'Failed to log assistant message'));
  }

  return { context: ctx, agentResponse, escalated, bookingConfirmed, confirmationCode };
};

// Build a system prompt that includes the current conversation state as context
const buildSystemPromptWithContext = (ctx: ConversationContext): string => {
  const stateContext: string[] = [];

  if (ctx.region) stateContext.push(`Destination: ${ctx.region}`);
  if (ctx.checkInDate) stateContext.push(`Check-in: ${ctx.checkInDate}`);
  if (ctx.checkOutDate) stateContext.push(`Check-out: ${ctx.checkOutDate}`);
  if (ctx.guestCount) stateContext.push(`Guests: ${ctx.guestCount}`);
  if (ctx.budget) stateContext.push(`Budget: up to $${ctx.budget}/night`);
  if (ctx.customerFirstName) stateContext.push(`Customer: ${ctx.customerFirstName} ${ctx.customerLastName ?? ''}`);
  if (ctx.customerEmail) stateContext.push(`Email: ${ctx.customerEmail}`);
  if (ctx.selectedPropertyId) stateContext.push(`Selected property ID: ${ctx.selectedPropertyId}`);

  const missingSearch = StateMachine.getMissingInfo(ctx);
  const missingCustomer = StateMachine.getMissingCustomerInfo(ctx);

  let contextBlock = '';
  if (stateContext.length > 0) {
    contextBlock += `\n\n## Current conversation state\nState: ${ctx.state}\n`;
    contextBlock += stateContext.join('\n');
  }
  if (missingSearch.length > 0 && ctx.state === 'GATHERING_INFO') {
    contextBlock += `\nStill needed to search: ${missingSearch.join(', ')}`;
  }
  if (missingCustomer.length > 0 && ctx.state === 'COLLECTING_DETAILS') {
    contextBlock += `\nStill needed to book: ${missingCustomer.join(', ')}`;
  }

  return systemPrompt + contextBlock;
};
