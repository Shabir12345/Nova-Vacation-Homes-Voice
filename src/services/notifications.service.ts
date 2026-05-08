// NotificationsService — fires Slack alerts when staff action is needed.
// Silent no-op when SLACK_WEBHOOK_URL is not configured.

import { config } from '../config';
import { logger } from '../utils/logger';

export type NotificationPriority = 'urgent' | 'normal' | 'low';

const PRIORITY_EMOJI: Record<NotificationPriority, string> = {
  urgent: ':rotating_light:',
  normal: ':bell:',
  low: ':information_source:',
};

interface SlackField {
  title: string;
  value: string;
  short?: boolean;
}

interface StaffNotification {
  title: string;
  priority: NotificationPriority;
  fields: SlackField[];
  referenceId?: number;
}

const sendSlack = async (payload: StaffNotification): Promise<void> => {
  if (!config.SLACK_WEBHOOK_URL) return;

  const emoji = PRIORITY_EMOJI[payload.priority];
  const body = {
    text: `${emoji} *${payload.title}*`,
    attachments: [
      {
        color: payload.priority === 'urgent' ? '#e53e3e' : payload.priority === 'normal' ? '#3182ce' : '#718096',
        fields: payload.fields.map((f) => ({ title: f.title, value: f.value, short: f.short ?? true })),
        footer: `Nova Voice Agent${payload.referenceId ? ` · Ref #${payload.referenceId}` : ''}`,
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const res = await fetch(config.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Slack notification failed');
    }
  } catch (err) {
    // Never let a notification failure affect the call flow
    logger.warn({ err }, 'Slack notification error');
  }
};

export const NotificationsService = {
  newReservationInterest: (params: {
    id: number;
    callerName: string;
    callerPhone: string;
    destination: string;
    checkIn?: string;
    checkOut?: string;
    guestCount?: number;
    budget?: string;
  }) =>
    sendSlack({
      title: 'New Reservation Interest',
      priority: 'normal',
      referenceId: params.id,
      fields: [
        { title: 'Caller', value: params.callerName },
        { title: 'Phone', value: params.callerPhone },
        { title: 'Destination', value: params.destination },
        { title: 'Dates', value: params.checkIn && params.checkOut ? `${params.checkIn} → ${params.checkOut}` : 'Not specified' },
        { title: 'Guests', value: params.guestCount ? String(params.guestCount) : 'Not specified' },
        { title: 'Budget', value: params.budget ?? 'Not specified' },
      ],
    }),

  newMaintenanceRequest: (params: {
    id: number;
    reservationId: string;
    maintenanceType: string;
    description: string;
    urgency: string;
  }) =>
    sendSlack({
      title: 'Maintenance Request',
      priority: params.urgency === 'high' ? 'urgent' : 'normal',
      referenceId: params.id,
      fields: [
        { title: 'Reservation', value: params.reservationId },
        { title: 'Type', value: params.maintenanceType },
        { title: 'Urgency', value: params.urgency.toUpperCase() },
        { title: 'Description', value: params.description, short: false },
      ],
    }),

  newCleaningRequest: (params: {
    id: number;
    reservationId: string;
    preferredTime?: string;
    notes?: string;
  }) =>
    sendSlack({
      title: 'Cleaning Request',
      priority: 'normal',
      referenceId: params.id,
      fields: [
        { title: 'Reservation', value: params.reservationId },
        { title: 'Preferred Time', value: params.preferredTime ?? 'Not specified' },
        { title: 'Notes', value: params.notes ?? '—', short: false },
      ],
    }),

  newExtensionRequest: (params: {
    id: number;
    reservationId: string;
    currentCheckout?: string;
    requestedCheckout: string;
  }) =>
    sendSlack({
      title: 'Stay Extension Request',
      priority: 'normal',
      referenceId: params.id,
      fields: [
        { title: 'Reservation', value: params.reservationId },
        { title: 'Current Checkout', value: params.currentCheckout ?? 'Unknown' },
        { title: 'Requested Checkout', value: params.requestedCheckout },
      ],
    }),

  newBusinessInquiry: (params: {
    id: number;
    callerName: string;
    callerPhone: string;
    inquiryType: string;
    reason: string;
  }) =>
    sendSlack({
      title: 'Business Inquiry',
      priority: 'low',
      referenceId: params.id,
      fields: [
        { title: 'Caller', value: params.callerName },
        { title: 'Phone', value: params.callerPhone },
        { title: 'Type', value: params.inquiryType },
        { title: 'Details', value: params.reason, short: false },
      ],
    }),

  newServiceRequest: (params: {
    id: number;
    reservationId: string;
    serviceType: string;
    details?: string;
  }) =>
    sendSlack({
      title: 'Service Request',
      priority: 'low',
      referenceId: params.id,
      fields: [
        { title: 'Reservation', value: params.reservationId },
        { title: 'Service', value: params.serviceType },
        { title: 'Details', value: params.details ?? '—', short: false },
      ],
    }),
};
