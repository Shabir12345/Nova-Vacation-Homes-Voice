// Agent tool definitions — these are the structured functions the LLM can call
// Each tool maps directly to a service operation with a typed schema for Claude's tool use API

import Anthropic from '@anthropic-ai/sdk';
import { PropertyService } from '../services/property.service';
import { BookingService } from '../services/booking.service';
import { CustomerService } from '../services/customer.service';
import { logger } from '../utils/logger';

// ─── Tool Definitions (schema sent to Claude) ────────────────────────────────

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'search_properties',
    description:
      'Search for available vacation properties based on customer criteria. ' +
      'Use this after collecting dates, guest count, and region from the customer.',
    input_schema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'Destination region or city (e.g. "Cancun", "Miami", "Key West")',
        },
        check_in_date: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format',
        },
        check_out_date: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format',
        },
        guest_count: {
          type: 'number',
          description: 'Total number of guests including children',
        },
        max_budget_per_night: {
          type: 'number',
          description: 'Maximum price per night in USD (optional)',
        },
        min_bedrooms: {
          type: 'number',
          description: 'Minimum number of bedrooms required (optional)',
        },
        amenities: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Desired amenities (optional). Options: pool, hot_tub, ocean_view, beach_access, ' +
            'kitchen, wifi, concierge, pet_friendly',
        },
      },
      required: ['region', 'check_in_date', 'check_out_date', 'guest_count'],
    },
  },
  {
    name: 'get_property_details',
    description:
      'Get full details for a specific property including amenities, house rules, ' +
      'cancellation policy, and pricing for the requested dates.',
    input_schema: {
      type: 'object',
      properties: {
        property_id: {
          type: 'number',
          description: 'The numeric ID of the property',
        },
        check_in_date: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format (for pricing calculation)',
        },
        check_out_date: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format (for pricing calculation)',
        },
      },
      required: ['property_id', 'check_in_date', 'check_out_date'],
    },
  },
  {
    name: 'check_availability',
    description:
      'Check real-time availability and get exact pricing for a specific property and dates. ' +
      'Always call this before quoting a final price or confirming a booking.',
    input_schema: {
      type: 'object',
      properties: {
        property_id: {
          type: 'number',
          description: 'The numeric ID of the property',
        },
        check_in_date: {
          type: 'string',
          description: 'Check-in date in YYYY-MM-DD format',
        },
        check_out_date: {
          type: 'string',
          description: 'Check-out date in YYYY-MM-DD format',
        },
      },
      required: ['property_id', 'check_in_date', 'check_out_date'],
    },
  },
  {
    name: 'get_customer_by_email',
    description:
      'Look up an existing customer by email address to retrieve their profile ' +
      'and booking history. Use this when a customer mentions an existing reservation.',
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: "Customer's email address",
        },
      },
      required: ['email'],
    },
  },
  {
    name: 'create_customer',
    description:
      'Create a new customer record. Use this after collecting name, email, and phone ' +
      'from a first-time caller who is ready to book.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: "Customer's email address" },
        first_name: { type: 'string', description: "Customer's first name" },
        last_name: { type: 'string', description: "Customer's last name" },
        phone: { type: 'string', description: "Customer's phone number" },
      },
      required: ['email', 'first_name', 'last_name'],
    },
  },
  {
    name: 'create_booking',
    description:
      'Create a confirmed reservation. Only call this AFTER: ' +
      '(1) availability has been verified, ' +
      '(2) all customer details are collected, ' +
      '(3) customer has explicitly confirmed the booking summary. ' +
      'This is irreversible — a confirmation email is sent immediately.',
    input_schema: {
      type: 'object',
      properties: {
        property_id: { type: 'number', description: 'Property ID' },
        customer_id: { type: 'number', description: 'Customer ID (from get_customer or create_customer)' },
        check_in_date: { type: 'string', description: 'Check-in date YYYY-MM-DD' },
        check_out_date: { type: 'string', description: 'Check-out date YYYY-MM-DD' },
        guest_count: { type: 'number', description: 'Number of guests' },
        total_price: { type: 'number', description: 'Total price in USD including all fees' },
        special_requests: {
          type: 'string',
          description: "Customer's special requests (optional)",
        },
      },
      required: [
        'property_id',
        'customer_id',
        'check_in_date',
        'check_out_date',
        'guest_count',
        'total_price',
      ],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Transfer the call to a human agent. Use this when: ' +
      'customer requests a human, existing booking needs modification, ' +
      'payment issues arise, customer is frustrated, or you are uncertain how to proceed.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: [
            'customer_request',
            'existing_booking_modification',
            'payment_issue',
            'customer_distress',
            'system_error',
            'complex_request',
            'unclear_intent',
          ],
          description: 'Reason for escalation',
        },
        summary: {
          type: 'string',
          description:
            'Brief summary of the conversation so far for the human agent (1-2 sentences)',
        },
      },
      required: ['reason', 'summary'],
    },
  },
];

// ─── Tool Input Types ─────────────────────────────────────────────────────────

interface SearchPropertiesInput {
  region: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  max_budget_per_night?: number;
  min_bedrooms?: number;
  amenities?: string[];
}

interface GetPropertyDetailsInput {
  property_id: number;
  check_in_date: string;
  check_out_date: string;
}

interface CheckAvailabilityInput {
  property_id: number;
  check_in_date: string;
  check_out_date: string;
}

interface GetCustomerByEmailInput {
  email: string;
}

interface CreateCustomerInput {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
}

interface CreateBookingInput {
  property_id: number;
  customer_id: number;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  total_price: number;
  special_requests?: string;
}

interface EscalateToHumanInput {
  reason: string;
  summary: string;
}

// ─── Tool Executor ────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export const executeTool = async (
  toolName: string,
  input: unknown
): Promise<ToolResult> => {
  logger.info({ tool: toolName }, 'Executing agent tool');

  try {
    switch (toolName) {
      case 'search_properties': {
        const params = input as SearchPropertiesInput;
        const properties = await PropertyService.searchProperties({
          region: params.region,
          checkInDate: params.check_in_date,
          checkOutDate: params.check_out_date,
          guestCount: params.guest_count,
          maxBudgetPerNight: params.max_budget_per_night,
          minBedrooms: params.min_bedrooms,
          amenities: params.amenities,
        });
        return {
          success: true,
          data: {
            count: properties.length,
            properties: properties.slice(0, 5).map((p) => ({
              id: p.id,
              name: p.name,
              region: p.region,
              pricePerNight: p.pricePerNight,
              bedrooms: p.bedrooms,
              bathrooms: p.bathrooms,
              maxGuests: p.maxGuests,
              amenities: p.amenities,
              rating: p.rating,
            })),
          },
        };
      }

      case 'get_property_details': {
        const params = input as GetPropertyDetailsInput;
        const [property, pricing] = await Promise.all([
          PropertyService.getPropertyDetails(params.property_id),
          PropertyService.getAvailabilityAndPricing(
            params.property_id,
            params.check_in_date,
            params.check_out_date
          ),
        ]);

        if (!property) {
          return { success: false, error: `Property ${params.property_id} not found` };
        }

        return {
          success: true,
          data: {
            id: property.id,
            name: property.name,
            region: property.region,
            address: property.address,
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms,
            maxGuests: property.maxGuests,
            amenities: property.amenities,
            houseRules: property.houseRules,
            cancellationPolicy: property.cancellationPolicy,
            description: property.description,
            rating: property.rating,
            pricing: pricing.breakdown,
            totalPrice: pricing.totalPrice,
            available: pricing.available,
          },
        };
      }

      case 'check_availability': {
        const params = input as CheckAvailabilityInput;
        const result = await PropertyService.getAvailabilityAndPricing(
          params.property_id,
          params.check_in_date,
          params.check_out_date
        );
        return {
          success: true,
          data: {
            available: result.available,
            totalPrice: result.totalPrice,
            ...result.breakdown,
          },
        };
      }

      case 'get_customer_by_email': {
        const params = input as GetCustomerByEmailInput;
        const customer = await CustomerService.getByEmail(params.email);
        if (!customer) {
          return { success: true, data: { found: false, email: params.email } };
        }
        return {
          success: true,
          data: {
            found: true,
            id: customer.id,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            phone: customer.phone,
            totalBookings: customer.totalBookings,
            preferredRegion: customer.preferredRegion,
          },
        };
      }

      case 'create_customer': {
        const params = input as CreateCustomerInput;
        const customer = await CustomerService.createCustomer({
          email: params.email,
          firstName: params.first_name,
          lastName: params.last_name,
          phone: params.phone,
        });
        return {
          success: true,
          data: {
            id: customer.id,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
          },
        };
      }

      case 'create_booking': {
        const params = input as CreateBookingInput;
        const booking = await BookingService.createBooking({
          propertyId: params.property_id,
          customerId: params.customer_id,
          checkInDate: params.check_in_date,
          checkOutDate: params.check_out_date,
          guestCount: params.guest_count,
          totalPrice: params.total_price,
          specialRequests: params.special_requests,
        });
        return {
          success: true,
          data: {
            confirmationCode: booking.confirmationCode,
            propertyId: booking.propertyId,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            totalNights: booking.totalNights,
            totalPrice: booking.totalPrice,
            status: booking.status,
          },
        };
      }

      case 'escalate_to_human': {
        const params = input as EscalateToHumanInput;
        logger.info({ reason: params.reason, summary: params.summary }, 'Escalating to human');
        // In production: trigger Twilio transfer or notify human agent queue
        return {
          success: true,
          data: {
            escalated: true,
            reason: params.reason,
            message: 'Transferring you to one of our specialists now. One moment please.',
            estimatedWait: '1-2 minutes',
          },
        };
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
