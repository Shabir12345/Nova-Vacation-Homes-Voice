// Twilio REST API client — outbound actions like transferring calls,
// sending SMS confirmations, and looking up call details

import twilio from 'twilio';
import { logger } from '../utils/logger';

const getTwilioClient = (): twilio.Twilio => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
  }

  return twilio(accountSid, authToken);
};

export const TwilioClient = {
  // Transfer an active call to a human agent queue
  transferToHuman: async (callSid: string, humanQueueNumber: string): Promise<void> => {
    try {
      const client = getTwilioClient();
      await client.calls(callSid).update({
        twiml: `<Response>
  <Say>Please hold while I connect you with a specialist.</Say>
  <Dial>${humanQueueNumber}</Dial>
</Response>`,
      });
      logger.info({ callSid, target: humanQueueNumber }, 'Call transferred to human');
    } catch (error) {
      logger.error(error, 'Failed to transfer call');
      throw error;
    }
  },

  // Send SMS booking confirmation to customer
  sendBookingConfirmationSMS: async (
    toPhone: string,
    confirmationCode: string,
    propertyName: string,
    checkInDate: string
  ): Promise<void> => {
    try {
      const client = getTwilioClient();
      const fromNumber = process.env.TWILIO_PHONE_NUMBER;

      if (!fromNumber) throw new Error('TWILIO_PHONE_NUMBER is required');

      await client.messages.create({
        body:
          `Nova Vacation Homes: Your booking is confirmed! ` +
          `Confirmation: ${confirmationCode}. ` +
          `Property: ${propertyName}. ` +
          `Check-in: ${checkInDate}. ` +
          `Reply STOP to opt out.`,
        from: fromNumber,
        to: toPhone,
      });

      logger.info({ toPhone, confirmationCode }, 'Booking confirmation SMS sent');
    } catch (error) {
      logger.error(error, 'Failed to send SMS');
      // Don't throw — SMS failure should not break the booking flow
    }
  },

  // Hang up a call gracefully
  hangUp: async (callSid: string): Promise<void> => {
    try {
      const client = getTwilioClient();
      await client.calls(callSid).update({ status: 'completed' });
      logger.info({ callSid }, 'Call hung up');
    } catch (error) {
      logger.error(error, 'Failed to hang up call');
    }
  },
};
