// IntakeService — writes all inbound leads and service requests to OUR database
// These records feed the staff's follow-up workflow

import { getPool } from '../db/connection';
import { logger } from '../utils/logger';

export const IntakeService = {
  logBusinessInquiry: async (params: {
    callerName: string;
    callerPhone: string;
    callerEmail?: string;
    inquiryType: string;
    reason: string;
    callId?: string;
  }): Promise<number> => {
    const result = await getPool().query(
      `INSERT INTO intake_messages
         (call_id, intake_type, caller_name, caller_phone, caller_email, inquiry_type, reason, status)
       VALUES ($1, 'business_inquiry', $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [params.callId ?? null, params.callerName, params.callerPhone,
       params.callerEmail ?? null, params.inquiryType, params.reason]
    );
    logger.info({ id: result.rows[0].id, type: 'business_inquiry' }, 'Intake logged');
    return result.rows[0].id;
  },

  logReservationInterest: async (params: {
    callerName: string;
    callerPhone: string;
    callerEmail?: string;
    desiredDestination: string;
    checkInDate?: string;
    checkOutDate?: string;
    guestCount?: number;
    budget?: string;
    specialRequests?: string;
    callId?: string;
  }): Promise<number> => {
    const result = await getPool().query(
      `INSERT INTO intake_messages
         (call_id, intake_type, caller_name, caller_phone, caller_email,
          destination, check_in_date, check_out_date, guest_count, budget, special_notes, status)
       VALUES ($1, 'reservation_interest', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
       RETURNING id`,
      [
        params.callId ?? null,
        params.callerName, params.callerPhone, params.callerEmail ?? null,
        params.desiredDestination, params.checkInDate ?? null,
        params.checkOutDate ?? null, params.guestCount ?? null,
        params.budget ?? null, params.specialRequests ?? null,
      ]
    );
    logger.info({ id: result.rows[0].id, type: 'reservation_interest' }, 'Intake logged');
    return result.rows[0].id;
  },

  logExtensionRequest: async (params: {
    reservationId: string;
    currentCheckout?: string;
    requestedCheckout: string;
    notes?: string;
    callId?: string;
  }): Promise<number> => {
    const result = await getPool().query(
      `INSERT INTO intake_messages
         (call_id, intake_type, reason, special_notes, status)
       VALUES ($1, 'extension_request', $2, $3, 'pending')
       RETURNING id`,
      [
        params.callId ?? null,
        `Extension for reservation ${params.reservationId}. ` +
          `Current checkout: ${params.currentCheckout ?? 'unknown'}. ` +
          `Requested: ${params.requestedCheckout}`,
        params.notes ?? null,
      ]
    );
    logger.info({ id: result.rows[0].id, reservationId: params.reservationId }, 'Extension request logged');
    return result.rows[0].id;
  },

  logCleaningRequest: async (params: {
    reservationId: string;
    preferredTime?: string;
    notes?: string;
    callId?: string;
  }): Promise<number> => {
    const result = await getPool().query(
      `INSERT INTO service_requests
         (call_id, reservation_id, request_type, preferred_time, description, urgency, status)
       VALUES ($1, $2, 'cleaning', $3, $4, 'medium', 'pending')
       RETURNING id`,
      [params.callId ?? null, params.reservationId,
       params.preferredTime ?? null, params.notes ?? null]
    );
    logger.info({ id: result.rows[0].id, type: 'cleaning' }, 'Service request logged');
    return result.rows[0].id;
  },

  logMaintenanceRequest: async (params: {
    reservationId: string;
    maintenanceType: string;
    description: string;
    urgency: string;
    callId?: string;
  }): Promise<number> => {
    const result = await getPool().query(
      `INSERT INTO service_requests
         (call_id, reservation_id, request_type, sub_type, description, urgency, status)
       VALUES ($1, $2, 'maintenance', $3, $4, $5, 'pending')
       RETURNING id`,
      [params.callId ?? null, params.reservationId,
       params.maintenanceType, params.description, params.urgency]
    );
    logger.info({ id: result.rows[0].id, type: 'maintenance', urgency: params.urgency }, 'Service request logged');
    return result.rows[0].id;
  },

  logServiceRequest: async (params: {
    reservationId: string;
    serviceType: string;
    details?: string;
    callId?: string;
  }): Promise<number> => {
    const result = await getPool().query(
      `INSERT INTO service_requests
         (call_id, reservation_id, request_type, sub_type, description, urgency, status)
       VALUES ($1, $2, 'services', $3, $4, 'low', 'pending')
       RETURNING id`,
      [params.callId ?? null, params.reservationId,
       params.serviceType, params.details ?? null]
    );
    logger.info({ id: result.rows[0].id, serviceType: params.serviceType }, 'Service request logged');
    return result.rows[0].id;
  },
};
