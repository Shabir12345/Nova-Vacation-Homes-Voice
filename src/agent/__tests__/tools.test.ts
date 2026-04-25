import { toolDefinitions, executeTool } from '../tools';

// Mock all services so tests run without a real database
jest.mock('../../services/property.service', () => ({
  PropertyService: {
    searchProperties: jest.fn().mockResolvedValue([
      { id: 1, name: 'Casa Azul', region: 'Cancun', pricePerNight: 300, bedrooms: 3, bathrooms: 2, maxGuests: 8, amenities: ['pool'], rating: 4.8 },
    ]),
    getPropertyDetails: jest.fn().mockResolvedValue({
      id: 1, name: 'Casa Azul', region: 'Cancun', address: 'Paseo Kukulkan 45',
      bedrooms: 3, bathrooms: 2, maxGuests: 8, basePricePerNight: 300,
      amenities: ['pool', 'ocean_view'], houseRules: {}, cancellationPolicy: {}, rating: 4.8,
    }),
    getAvailabilityAndPricing: jest.fn().mockResolvedValue({
      available: true,
      totalPrice: 2250,
      breakdown: { nights: 7, pricePerNight: 300, subtotal: 2100, fees: 150 },
    }),
  },
}));

jest.mock('../../services/customer.service', () => ({
  CustomerService: {
    getByEmail: jest.fn().mockResolvedValue({
      id: 99, email: 'john@example.com', firstName: 'John', lastName: 'Smith',
      phone: '555-0100', totalBookings: 2, preferredRegion: 'Cancun',
    }),
    createCustomer: jest.fn().mockResolvedValue({
      id: 100, email: 'new@example.com', firstName: 'Jane', lastName: 'Doe',
    }),
  },
}));

jest.mock('../../services/booking.service', () => ({
  BookingService: {
    createBooking: jest.fn().mockResolvedValue({
      confirmationCode: 'NVH-2025-9999',
      propertyId: 1,
      checkInDate: '2025-03-15',
      checkOutDate: '2025-03-22',
      totalNights: 7,
      totalPrice: 2250,
      status: 'confirmed',
    }),
  },
}));

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe('toolDefinitions', () => {
  it('exports 7 tools', () => {
    expect(toolDefinitions).toHaveLength(7);
  });

  it('all tools have required fields', () => {
    for (const tool of toolDefinitions) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeTruthy();
    }
  });

  it('create_booking requires confirmation gate in description', () => {
    const bookingTool = toolDefinitions.find((t) => t.name === 'create_booking');
    expect(bookingTool?.description).toContain('explicitly confirmed');
  });
});

describe('executeTool', () => {
  describe('search_properties', () => {
    it('returns properties list on success', async () => {
      const result = await executeTool('search_properties', {
        region: 'Cancun',
        check_in_date: '2025-03-15',
        check_out_date: '2025-03-22',
        guest_count: 8,
      });
      expect(result.success).toBe(true);
      const data = result.data as { count: number; properties: unknown[] };
      expect(data.count).toBe(1);
      expect(data.properties).toHaveLength(1);
    });
  });

  describe('get_property_details', () => {
    it('returns property with pricing', async () => {
      const result = await executeTool('get_property_details', {
        property_id: 1,
        check_in_date: '2025-03-15',
        check_out_date: '2025-03-22',
      });
      expect(result.success).toBe(true);
      const data = result.data as { name: string; totalPrice: number; available: boolean };
      expect(data.name).toBe('Casa Azul');
      expect(data.totalPrice).toBe(2250);
      expect(data.available).toBe(true);
    });

    it('returns error when property not found', async () => {
      const { PropertyService } = jest.requireMock('../../services/property.service');
      PropertyService.getPropertyDetails.mockResolvedValueOnce(null);

      const result = await executeTool('get_property_details', {
        property_id: 999,
        check_in_date: '2025-03-15',
        check_out_date: '2025-03-22',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('999');
    });
  });

  describe('check_availability', () => {
    it('returns availability and pricing', async () => {
      const result = await executeTool('check_availability', {
        property_id: 1,
        check_in_date: '2025-03-15',
        check_out_date: '2025-03-22',
      });
      expect(result.success).toBe(true);
      const data = result.data as { available: boolean; totalPrice: number };
      expect(data.available).toBe(true);
      expect(data.totalPrice).toBe(2250);
    });
  });

  describe('get_customer_by_email', () => {
    it('returns customer when found', async () => {
      const result = await executeTool('get_customer_by_email', { email: 'john@example.com' });
      expect(result.success).toBe(true);
      const data = result.data as { found: boolean; firstName: string };
      expect(data.found).toBe(true);
      expect(data.firstName).toBe('John');
    });

    it('returns found:false when customer does not exist', async () => {
      const { CustomerService } = jest.requireMock('../../services/customer.service');
      CustomerService.getByEmail.mockResolvedValueOnce(null);

      const result = await executeTool('get_customer_by_email', { email: 'unknown@example.com' });
      expect(result.success).toBe(true);
      const data = result.data as { found: boolean };
      expect(data.found).toBe(false);
    });
  });

  describe('create_customer', () => {
    it('creates and returns new customer', async () => {
      const result = await executeTool('create_customer', {
        email: 'new@example.com',
        first_name: 'Jane',
        last_name: 'Doe',
      });
      expect(result.success).toBe(true);
      const data = result.data as { email: string };
      expect(data.email).toBe('new@example.com');
    });
  });

  describe('create_booking', () => {
    it('creates booking and returns confirmation code', async () => {
      const result = await executeTool('create_booking', {
        property_id: 1,
        customer_id: 99,
        check_in_date: '2025-03-15',
        check_out_date: '2025-03-22',
        guest_count: 8,
        total_price: 2250,
      });
      expect(result.success).toBe(true);
      const data = result.data as { confirmationCode: string; status: string };
      expect(data.confirmationCode).toBe('NVH-2025-9999');
      expect(data.status).toBe('confirmed');
    });
  });

  describe('escalate_to_human', () => {
    it('returns escalation confirmation', async () => {
      const result = await executeTool('escalate_to_human', {
        reason: 'payment_issue',
        summary: 'Customer wants to use a different card',
      });
      expect(result.success).toBe(true);
      const data = result.data as { escalated: boolean };
      expect(data.escalated).toBe(true);
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeTool('does_not_exist', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});
