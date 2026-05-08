// Customer service for managing customer profiles and history

import { Customer } from '../db/models';
import { CustomerQueries } from '../db/queries';
import { BookingService } from './booking.service';
import { logger } from '../utils/logger';

export interface CreateCustomerParams {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  preferredRegion?: string;
}

export interface CustomerProfile extends Customer {
  recentBookings?: Array<{
    confirmationCode: string;
    propertyName: string;
    checkInDate: string;
    checkOutDate: string;
  }>;
}

export const CustomerService = {
  getByEmail: async (email: string): Promise<Customer | null> => {
    try {
      return await CustomerQueries.findByEmail(email);
    } catch (error) {
      logger.error(error, 'Failed to get customer by email');
      throw error;
    }
  },

  getById: async (id: number): Promise<Customer | null> => {
    try {
      return await CustomerQueries.findById(id);
    } catch (error) {
      logger.error(error, 'Failed to get customer by id');
      throw error;
    }
  },

  createCustomer: async (params: CreateCustomerParams): Promise<Customer> => {
    try {
      // Check if customer already exists
      const existing = await CustomerService.getByEmail(params.email);
      if (existing) {
        throw new Error(`Customer with email ${params.email} already exists`);
      }

      const customer = await CustomerQueries.create({
        email: params.email,
        firstName: params.firstName,
        lastName: params.lastName,
        phone: params.phone,
        address: params.address,
        city: params.city,
        state: params.state,
        country: params.country,
        postalCode: params.postalCode,
        totalBookings: 0,
        preferredRegion: params.preferredRegion,
      });

      logger.info(
        { customerId: customer.id, email: params.email },
        'Customer created successfully'
      );
      return customer;
    } catch (error) {
      logger.error(error, 'Failed to create customer');
      throw error;
    }
  },

  updateCustomer: async (id: number, updates: Partial<Customer>): Promise<Customer> => {
    try {
      const updated = await CustomerQueries.update(id, {
        ...updates,
        updatedAt: new Date(),
      });

      logger.info({ customerId: id }, 'Customer updated');
      return updated;
    } catch (error) {
      logger.error(error, 'Failed to update customer');
      throw error;
    }
  },

  getCustomerProfile: async (email: string): Promise<CustomerProfile | null> => {
    try {
      const customer = await CustomerService.getByEmail(email);
      if (!customer) {
        return null;
      }

      const bookings = await BookingService.getCustomerBookings(customer.id);

      return {
        ...customer,
        recentBookings: bookings.map((b) => ({
          confirmationCode: b.confirmationCode,
          propertyName: '', // TODO: join with property name
          checkInDate: b.checkInDate,
          checkOutDate: b.checkOutDate,
        })),
      };
    } catch (error) {
      logger.error(error, 'Failed to get customer profile');
      throw error;
    }
  },

  getOrCreateCustomer: async (
    email: string,
    firstName?: string,
    lastName?: string,
    phone?: string
  ): Promise<Customer> => {
    try {
      // Try to find existing customer
      const existing = await CustomerService.getByEmail(email);
      if (existing) {
        return existing;
      }

      // Create new customer with minimal info
      if (!firstName || !lastName) {
        throw new Error('First name and last name required to create new customer');
      }

      return await CustomerService.createCustomer({
        email,
        firstName,
        lastName,
        phone,
      });
    } catch (error) {
      logger.error(error, 'Failed to get or create customer');
      throw error;
    }
  },
};
