// Agent tool definitions — one tool per action node in the call flow diagram
// Tools are grouped by which agent uses them: Master, Reservation Agent, Service Agent

import Anthropic from '@anthropic-ai/sdk';
import { ClientDbService } from '../services/client-db.service';
import { IntakeService } from '../services/intake.service';
import { FaqService } from '../services/faq.service';
import { logger } from '../utils/logger';

// ─── Tool Definitions (schema sent to Claude) ────────────────────────────────

export const masterAgentTools: Anthropic.Tool[] = [
  {
    name: 'detect_language',
    description:
      'Detect the language the caller is speaking and set it for the conversation. ' +
      'Call this at the very start if the greeting or first message is not in English.',
    input_schema: {
      type: 'object',
      properties: {
        detected_language: {
          type: 'string',
          enum: ['en', 'es', 'pt'],
          description: 'Detected language: en (English), es (Spanish), pt (Portuguese)',
        },
      },
      required: ['detected_language'],
    },
  },
  {
    name: 'classify_intent',
    description:
      'Classify the caller\'s primary reason for calling. Call this once you understand why they are calling.',
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['business_inquiry', 'general_information', 'future_guest', 'existing_guest'],
          description:
            'business_inquiry: non-guest business call (property owners, vendors, etc.). ' +
            'general_information: questions not tied to a reservation. ' +
            'future_guest: interested in booking / not yet reserved. ' +
            'existing_guest: has an active or recent reservation.',
        },
      },
      required: ['intent'],
    },
  },
  {
    name: 'lookup_faq',
    description:
      'Search the FAQ database for an answer to a general information question. ' +
      'Use for Branch 2 (General Information) callers.',
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The caller\'s question in plain text',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'log_business_inquiry',
    description:
      'Log a business inquiry call. Use for Branch 1 (Business Inquiry) after collecting all info. ' +
      'Tells the caller a team member will follow up.',
    input_schema: {
      type: 'object',
      properties: {
        caller_name: { type: 'string', description: 'Caller\'s full name' },
        caller_phone: { type: 'string', description: 'Caller\'s phone number' },
        caller_email: { type: 'string', description: 'Caller\'s email (optional)' },
        inquiry_type: {
          type: 'string',
          enum: ['property_owner', 'realtor', 'vendor_cleaning', 'vendor_software', 'vendor_other', 'other'],
          description: 'Type of business inquiry',
        },
        reason: { type: 'string', description: 'Summary of what the call is about' },
      },
      required: ['caller_name', 'caller_phone', 'inquiry_type', 'reason'],
    },
  },
  {
    name: 'classify_future_guest_intent',
    description:
      'For Future Guest callers — determine whether they want to make a reservation ' +
      'or just get general property information.',
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['make_reservation', 'general_information'],
          description:
            'make_reservation: they want to book a property. ' +
            'general_information: they want info about properties, pricing, availability.',
        },
      },
      required: ['intent'],
    },
  },
  {
    name: 'log_reservation_interest',
    description:
      'Log a future guest\'s reservation interest. Agent does NOT complete the booking — ' +
      'a staff member will follow up. Collect all details first.',
    input_schema: {
      type: 'object',
      properties: {
        caller_name: { type: 'string', description: 'Caller\'s full name' },
        caller_phone: { type: 'string', description: 'Caller\'s phone number' },
        caller_email: { type: 'string', description: 'Caller\'s email (optional)' },
        desired_destination: { type: 'string', description: 'Where they want to go' },
        check_in_date: { type: 'string', description: 'Desired check-in date (YYYY-MM-DD or natural language)' },
        check_out_date: { type: 'string', description: 'Desired check-out date (YYYY-MM-DD or natural language)' },
        guest_count: { type: 'number', description: 'Number of guests' },
        budget: { type: 'string', description: 'Budget range (optional)' },
        special_requests: { type: 'string', description: 'Any special requests (optional)' },
      },
      required: ['caller_name', 'caller_phone', 'desired_destination'],
    },
  },
  {
    name: 'lookup_property_info',
    description:
      'Look up general property information from the client database. ' +
      'Use for Future Guest general info requests and general property questions.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What the caller wants to know about — location, amenities, pricing, availability, etc.',
        },
        region: {
          type: 'string',
          description: 'Region or destination they are interested in (optional)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'verify_reservation',
    description:
      'Verify an existing guest reservation. ' +
      'IMPORTANT: You MUST collect BOTH (1) the caller\'s full name AND (2) their confirmation code OR email address before calling this. ' +
      'Never call with name alone — two guests can share the same name and you would pull the wrong booking. ' +
      'Ask for the confirmation code first (they received it by email when they booked). ' +
      'If they cannot find it, ask for the email address used when booking as a fallback. ' +
      'Only call this tool once you have name plus at least one of those two.',
    input_schema: {
      type: 'object',
      properties: {
        caller_name: { type: 'string', description: 'Guest\'s full name' },
        confirmation_code: { type: 'string', description: 'Booking confirmation code — ask for this first' },
        caller_email: { type: 'string', description: 'Email address used when booking — fallback if no confirmation code' },
      },
      required: ['caller_name'],
    },
  },
  {
    name: 'classify_existing_guest_intent',
    description:
      'After verifying the reservation, determine what the existing guest needs. ' +
      'Routes to Reservation Agent or Service Agent.',
    input_schema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: [
            'general_information',
            'listing_information',
            'check_in_check_out',
            'extend_reservation',
            'cleaning',
            'maintenance',
            'services',
          ],
          description:
            'general_information: general questions about their stay. ' +
            'listing_information: questions about the property/listing. ' +
            'check_in_check_out: check-in/out times, procedures, or issues. ' +
            'extend_reservation: want to extend their stay. ' +
            'cleaning: request cleaning service. ' +
            'maintenance: report maintenance issue (plumbing, AC, etc.). ' +
            'services: request additional services (pool heater, rental grill, etc.).',
        },
      },
      required: ['intent'],
    },
  },
];

export const reservationAgentTools: Anthropic.Tool[] = [
  {
    name: 'get_reservation_general_info',
    description: 'Look up general information about the guest\'s reservation from the database.',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID from verification step' },
        question: { type: 'string', description: 'The specific question the guest has' },
      },
      required: ['reservation_id', 'question'],
    },
  },
  {
    name: 'get_listing_information',
    description: 'Look up property/listing details for the guest\'s reserved property.',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID' },
        question: { type: 'string', description: 'What the guest wants to know about the property' },
      },
      required: ['reservation_id', 'question'],
    },
  },
  {
    name: 'get_checkin_checkout_info',
    description: 'Get check-in and check-out details, times, and procedures for the reservation.',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID' },
      },
      required: ['reservation_id'],
    },
  },
  {
    name: 'request_reservation_extension',
    description:
      'Log a reservation extension request. Does not modify the booking directly — ' +
      'logs for staff to action.',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID' },
        current_checkout: { type: 'string', description: 'Current check-out date' },
        requested_checkout: { type: 'string', description: 'Requested new check-out date' },
        notes: { type: 'string', description: 'Any additional notes from the guest' },
      },
      required: ['reservation_id', 'requested_checkout'],
    },
  },
];

export const serviceAgentTools: Anthropic.Tool[] = [
  {
    name: 'log_cleaning_request',
    description: 'Log a cleaning service request for the guest\'s property.',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID' },
        preferred_time: { type: 'string', description: 'Preferred time for cleaning (optional)' },
        notes: { type: 'string', description: 'Any specific cleaning notes from the guest' },
      },
      required: ['reservation_id'],
    },
  },
  {
    name: 'log_maintenance_request',
    description: 'Log a maintenance issue reported by the guest.',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID' },
        maintenance_type: {
          type: 'string',
          enum: ['plumbing', 'ac', 'electrical', 'appliance', 'structural', 'other'],
          description: 'Type of maintenance issue',
        },
        description: { type: 'string', description: 'Description of the issue' },
        urgency: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'emergency'],
          description: 'Urgency level — emergency for safety/habitability issues',
        },
      },
      required: ['reservation_id', 'maintenance_type', 'description', 'urgency'],
    },
  },
  {
    name: 'log_service_request',
    description: 'Log a request for additional services (pool heater, rental grill, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        reservation_id: { type: 'string', description: 'Reservation ID' },
        service_type: {
          type: 'string',
          enum: ['pool_heater', 'rental_grill', 'extra_linens', 'crib', 'other'],
          description: 'Type of service requested',
        },
        details: { type: 'string', description: 'Any additional details about the request' },
      },
      required: ['reservation_id', 'service_type'],
    },
  },
];

// All tools combined — decision engine selects the right set per active agent
export const allTools = [...masterAgentTools, ...reservationAgentTools, ...serviceAgentTools];

// ─── Tool Result Types ────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Tool Executor ────────────────────────────────────────────────────────────

export const executeTool = async (toolName: string, input: unknown): Promise<ToolResult> => {
  logger.info({ tool: toolName }, 'Executing agent tool');

  const params = input as Record<string, unknown>;

  try {
    switch (toolName) {

      // ── Master Agent Tools ──────────────────────────────────────────────

      case 'detect_language':
        return { success: true, data: { language: params['detected_language'], set: true } };

      case 'classify_intent':
        return { success: true, data: { intent: params['intent'], classified: true } };

      case 'lookup_faq': {
        const answer = await FaqService.search(params['question'] as string);
        return { success: true, data: { found: !!answer, answer: answer ?? 'No FAQ match found for that question.' } };
      }

      case 'log_business_inquiry': {
        const id = await IntakeService.logBusinessInquiry({
          callerName: params['caller_name'] as string,
          callerPhone: params['caller_phone'] as string,
          callerEmail: params['caller_email'] as string | undefined,
          inquiryType: params['inquiry_type'] as string,
          reason: params['reason'] as string,
        });
        return { success: true, data: { logged: true, intakeId: id, message: 'A member of our team will get back to you shortly.' } };
      }

      case 'classify_future_guest_intent':
        return { success: true, data: { intent: params['intent'], classified: true } };

      case 'log_reservation_interest': {
        const id = await IntakeService.logReservationInterest({
          callerName: params['caller_name'] as string,
          callerPhone: params['caller_phone'] as string,
          callerEmail: params['caller_email'] as string | undefined,
          desiredDestination: params['desired_destination'] as string,
          checkInDate: params['check_in_date'] as string | undefined,
          checkOutDate: params['check_out_date'] as string | undefined,
          guestCount: params['guest_count'] as number | undefined,
          budget: params['budget'] as string | undefined,
          specialRequests: params['special_requests'] as string | undefined,
        });
        return { success: true, data: { logged: true, intakeId: id, message: 'A member of our team will follow up to confirm the reservation.' } };
      }

      case 'lookup_property_info': {
        // Region is a free-form hint (city, state, or destination name) —
        // fold it into the query so it can match title/address text.
        const query = params['query'] as string;
        const region = params['region'] as string | undefined;
        const combined = region ? `${query} ${region}`.trim() : query;
        const info = await ClientDbService.searchListings({ query: combined });
        return { success: true, data: info };
      }

      case 'verify_reservation': {
        const guestName = params['caller_name'] as string;
        const email = params['caller_email'] as string | undefined;
        const confirmationCode = params['confirmation_code'] as string | undefined;

        // Require two identifying fields — name alone can match the wrong guest.
        if (!confirmationCode && !email) {
          return {
            success: true,
            data: {
              found: false,
              needsMoreInfo: true,
              message: 'A second identifier is required. Ask the caller for their confirmation code (from their booking email) or the email address they used when booking.',
            },
          };
        }

        const reservation = await ClientDbService.findReservation({
          guestName,
          email,
          confirmationCode,
        });
        if (!reservation) {
          return {
            success: true,
            data: {
              found: false,
              message: 'No reservation found with that name and confirmation code. Ask the caller to double-check the code, or try their email address instead.',
            },
          };
        }
        return { success: true, data: { found: true, reservation } };
      }

      case 'classify_existing_guest_intent':
        return { success: true, data: { intent: params['intent'], classified: true } };

      // ── Reservation Agent Tools ─────────────────────────────────────────

      case 'get_reservation_general_info': {
        // The agent picks the relevant fields from the full record using the question.
        const info = await ClientDbService.getReservationDetails(
          params['reservation_id'] as string
        );
        return { success: true, data: info ?? { found: false } };
      }

      case 'get_listing_information': {
        // Returns the full listing record — agent picks fields relevant to the question.
        const listing = await ClientDbService.getListingInfo(
          params['reservation_id'] as string
        );
        return { success: true, data: listing };
      }

      case 'get_checkin_checkout_info': {
        const info = await ClientDbService.getCheckinInfo(params['reservation_id'] as string);
        return { success: true, data: info };
      }

      case 'request_reservation_extension': {
        const id = await IntakeService.logExtensionRequest({
          reservationId: params['reservation_id'] as string,
          currentCheckout: params['current_checkout'] as string | undefined,
          requestedCheckout: params['requested_checkout'] as string,
          notes: params['notes'] as string | undefined,
        });
        return { success: true, data: { logged: true, intakeId: id, message: 'Your extension request has been logged. A team member will confirm availability and contact you.' } };
      }

      // ── Service Agent Tools ─────────────────────────────────────────────

      case 'log_cleaning_request': {
        const id = await IntakeService.logCleaningRequest({
          reservationId: params['reservation_id'] as string,
          preferredTime: params['preferred_time'] as string | undefined,
          notes: params['notes'] as string | undefined,
        });
        return { success: true, data: { logged: true, intakeId: id, message: 'Your cleaning request has been logged and our team will be in touch.' } };
      }

      case 'log_maintenance_request': {
        const id = await IntakeService.logMaintenanceRequest({
          reservationId: params['reservation_id'] as string,
          maintenanceType: params['maintenance_type'] as string,
          description: params['description'] as string,
          urgency: params['urgency'] as string,
        });
        return { success: true, data: { logged: true, intakeId: id, message: 'Your maintenance request has been logged. Our team will follow up as soon as possible.' } };
      }

      case 'log_service_request': {
        const id = await IntakeService.logServiceRequest({
          reservationId: params['reservation_id'] as string,
          serviceType: params['service_type'] as string,
          details: params['details'] as string | undefined,
        });
        return { success: true, data: { logged: true, intakeId: id, message: 'Your service request has been logged and our team will follow up.' } };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ tool: toolName, error: message }, 'Tool execution failed');
    return { success: false, error: message };
  }
};
