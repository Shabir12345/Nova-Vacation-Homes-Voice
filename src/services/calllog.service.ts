// Call logging service for tracking and analytics

import { getPool } from '../db/connection';
import { CallLog, AgentInteraction } from '../db/models';
import { CallLogQueries } from '../db/queries';
import { logger } from '../utils/logger';

export interface CreateCallLogParams {
  callId: string;
  phoneNumber?: string;
  intent?: string;
  customerId?: number;
  bookingId?: number;
}

export interface LogInteractionParams {
  callId: string;
  role: 'user' | 'assistant' | 'system';
  message: string;
  toolCalled?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
}

export const CallLogService = {
  createCallLog: async (params: CreateCallLogParams): Promise<CallLog> => {
    try {
      return await CallLogQueries.create({
        callId: params.callId,
        phoneNumber: params.phoneNumber,
        incoming: true,
        intent: params.intent,
        customerId: params.customerId,
        bookingId: params.bookingId,
        escalated: false,
        durationSeconds: 0,
      });
    } catch (error) {
      logger.error(error, 'Failed to create call log');
      throw error;
    }
  },

  logInteraction: async (params: LogInteractionParams): Promise<AgentInteraction> => {
    try {
      const result = await getPool().query(
        `INSERT INTO agent_interactions (call_id, role, message, tool_called, tool_params, tool_result)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          params.callId,
          params.role,
          params.message,
          params.toolCalled || null,
          params.toolParams ? JSON.stringify(params.toolParams) : null,
          params.toolResult ? JSON.stringify(params.toolResult) : null,
        ]
      );

      return result.rows[0];
    } catch (error) {
      logger.error(error, 'Failed to log interaction');
      throw error;
    }
  },

  endCall: async (
    callId: string,
    durationSeconds: number,
    escalated = false,
    escalationReason?: string,
    propertiesShown?: number[],
    transcript?: string,
    errorMessage?: string,
    topIntent?: string
  ): Promise<CallLog> => {
    try {
      const result = await getPool().query(
        `UPDATE call_logs
         SET duration_seconds = $1, escalated = $2, escalation_reason = $3,
             properties_shown = $4, transcript = $5, error_message = $6,
             top_intent = $7, ended_at = CURRENT_TIMESTAMP
         WHERE call_id = $8
         RETURNING *`,
        [
          durationSeconds,
          escalated,
          escalationReason || null,
          propertiesShown ? JSON.stringify(propertiesShown) : null,
          transcript || null,
          errorMessage || null,
          topIntent && topIntent !== 'unknown' ? topIntent : null,
          callId,
        ]
      );

      if (result.rows.length === 0) {
        throw new Error(`Call log ${callId} not found`);
      }

      logger.info(
        { callId, duration: durationSeconds, escalated },
        'Call ended and logged'
      );

      return result.rows[0];
    } catch (error) {
      logger.error(error, 'Failed to end call');
      throw error;
    }
  },

  getCallTranscript: async (callId: string): Promise<AgentInteraction[]> => {
    try {
      const result = await getPool().query(
        `SELECT * FROM agent_interactions
         WHERE call_id = $1
         ORDER BY created_at ASC`,
        [callId]
      );

      return result.rows;
    } catch (error) {
      logger.error(error, 'Failed to get call transcript');
      throw error;
    }
  },

  getCallStats: async (
    startDate?: string,
    endDate?: string
  ): Promise<Record<string, unknown>> => {
    try {
      let query = `
        SELECT
          COUNT(*) as total_calls,
          SUM(CASE WHEN escalated THEN 1 ELSE 0 END) as escalated_calls,
          SUM(CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END) as successful_bookings,
          AVG(duration_seconds) as avg_duration
        FROM call_logs
      `;

      const params: string[] = [];

      if (startDate || endDate) {
        query += ' WHERE ';
        if (startDate) {
          params.push(startDate);
          query += `created_at >= $${params.length}`;
        }
        if (endDate) {
          if (params.length > 0) query += ' AND ';
          params.push(endDate);
          query += `created_at <= $${params.length}`;
        }
      }

      const result = await getPool().query(query, params);

      return {
        totalCalls: parseInt(result.rows[0].total_calls, 10),
        escalatedCalls: parseInt(result.rows[0].escalated_calls, 10),
        successfulBookings: parseInt(result.rows[0].successful_bookings, 10),
        avgDuration: result.rows[0].avg_duration,
      };
    } catch (error) {
      logger.error(error, 'Failed to get call stats');
      throw error;
    }
  },
};
