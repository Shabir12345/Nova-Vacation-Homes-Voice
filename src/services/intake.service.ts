// IntakeService — writes all inbound leads and service requests to OUR database
// These records feed the staff's follow-up workflow

import { getPool } from '../db/connection';
import { logger } from '../utils/logger';
import { NotificationsService } from './notifications.service';

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
    const id: number = result.rows[0].id;
    logger.info({ id, type: 'business_inquiry' }, 'Intake logged');
    NotificationsService.newBusinessInquiry({
      id,
      callerName: params.callerName,
      callerPhone: params.callerPhone,
      inquiryType: params.inquiryType,
      reason: params.reason,
    }).catch(() => undefined);
    return id;
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
    const id: number = result.rows[0].id;
    logger.info({ id, type: 'reservation_interest' }, 'Intake logged');
    NotificationsService.newReservationInterest({
      id,
      callerName: params.callerName,
      callerPhone: params.callerPhone,
      destination: params.desiredDestination,
      checkIn: params.checkInDate,
      checkOut: params.checkOutDate,
      guestCount: params.guestCount,
      budget: params.budget,
    }).catch(() => undefined);
    return id;
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
    const id: number = result.rows[0].id;
    logger.info({ id, reservationId: params.reservationId }, 'Extension request logged');
    NotificationsService.newExtensionRequest({
      id,
      reservationId: params.reservationId,
      currentCheckout: params.currentCheckout,
      requestedCheckout: params.requestedCheckout,
    }).catch(() => undefined);
    return id;
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
    const id: number = result.rows[0].id;
    logger.info({ id, type: 'cleaning' }, 'Service request logged');
    NotificationsService.newCleaningRequest({
      id,
      reservationId: params.reservationId,
      preferredTime: params.preferredTime,
      notes: params.notes,
    }).catch(() => undefined);
    return id;
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
    const id: number = result.rows[0].id;
    logger.info({ id, type: 'maintenance', urgency: params.urgency }, 'Service request logged');
    NotificationsService.newMaintenanceRequest({
      id,
      reservationId: params.reservationId,
      maintenanceType: params.maintenanceType,
      description: params.description,
      urgency: params.urgency,
    }).catch(() => undefined);
    return id;
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
    const id: number = result.rows[0].id;
    logger.info({ id, serviceType: params.serviceType }, 'Service request logged');
    NotificationsService.newServiceRequest({
      id,
      reservationId: params.reservationId,
      serviceType: params.serviceType,
      details: params.details,
    }).catch(() => undefined);
    return id;
  },
};
