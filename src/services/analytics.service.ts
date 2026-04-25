// Analytics service — queries call_logs for business-level reporting

import { getPool } from '../db/connection';
import { logger } from '../utils/logger';

export interface CallSummaryStats {
  totalCalls: number;
  successfulBookings: number;
  escalatedCalls: number;
  bookingConversionRate: number; // 0–1
  escalationRate: number;        // 0–1
  avgCallDurationSeconds: number;
}

export interface IntentBreakdown {
  intent: string;
  count: number;
  bookings: number;
}

export interface DailyStats {
  date: string;
  totalCalls: number;
  bookings: number;
  escalations: number;
}

export const AnalyticsService = {
  getSummary: async (daysBack = 30): Promise<CallSummaryStats> => {
    try {
      const result = await getPool().query(
        `SELECT
          COUNT(*)                                                    AS total_calls,
          SUM(CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END)    AS successful_bookings,
          SUM(CASE WHEN escalated THEN 1 ELSE 0 END)                 AS escalated_calls,
          AVG(COALESCE(duration_seconds, 0))                         AS avg_duration
        FROM call_logs
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1`,
        [daysBack]
      );

      const row = result.rows[0];
      const totalCalls = parseInt(row.total_calls, 10) || 0;
      const successfulBookings = parseInt(row.successful_bookings, 10) || 0;
      const escalatedCalls = parseInt(row.escalated_calls, 10) || 0;

      return {
        totalCalls,
        successfulBookings,
        escalatedCalls,
        bookingConversionRate: totalCalls > 0 ? successfulBookings / totalCalls : 0,
        escalationRate: totalCalls > 0 ? escalatedCalls / totalCalls : 0,
        avgCallDurationSeconds: parseFloat(row.avg_duration) || 0,
      };
    } catch (error) {
      logger.error(error, 'Failed to get call summary stats');
      throw error;
    }
  },

  getIntentBreakdown: async (daysBack = 30): Promise<IntentBreakdown[]> => {
    try {
      const result = await getPool().query(
        `SELECT
          COALESCE(intent, 'unknown')                              AS intent,
          COUNT(*)                                                  AS count,
          SUM(CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END)  AS bookings
        FROM call_logs
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY COALESCE(intent, 'unknown')
        ORDER BY count DESC`,
        [daysBack]
      );

      return result.rows.map((r) => ({
        intent: r.intent,
        count: parseInt(r.count, 10),
        bookings: parseInt(r.bookings, 10),
      }));
    } catch (error) {
      logger.error(error, 'Failed to get intent breakdown');
      throw error;
    }
  },

  getDailyStats: async (daysBack = 14): Promise<DailyStats[]> => {
    try {
      const result = await getPool().query(
        `SELECT
          DATE(created_at)                                           AS date,
          COUNT(*)                                                   AS total_calls,
          SUM(CASE WHEN booking_id IS NOT NULL THEN 1 ELSE 0 END)   AS bookings,
          SUM(CASE WHEN escalated THEN 1 ELSE 0 END)                AS escalations
        FROM call_logs
        WHERE created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY DATE(created_at)
        ORDER BY date DESC`,
        [daysBack]
      );

      return result.rows.map((r) => ({
        date: r.date,
        totalCalls: parseInt(r.total_calls, 10),
        bookings: parseInt(r.bookings, 10),
        escalations: parseInt(r.escalations, 10),
      }));
    } catch (error) {
      logger.error(error, 'Failed to get daily stats');
      throw error;
    }
  },

  getTopEscalationReasons: async (daysBack = 30): Promise<Array<{ reason: string; count: number }>> => {
    try {
      const result = await getPool().query(
        `SELECT
          COALESCE(escalation_reason, 'unknown') AS reason,
          COUNT(*)                               AS count
        FROM call_logs
        WHERE escalated = true
          AND created_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY escalation_reason
        ORDER BY count DESC
        LIMIT 10`,
        [daysBack]
      );

      return result.rows.map((r) => ({
        reason: r.reason,
        count: parseInt(r.count, 10),
      }));
    } catch (error) {
      logger.error(error, 'Failed to get escalation reasons');
      throw error;
    }
  },
};
