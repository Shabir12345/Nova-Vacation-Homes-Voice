// Common database query helpers

import { getPool } from './connection';
import { Customer, Property, Booking, CallLog } from './models';
import { logger } from '../utils/logger';

// Customer queries
export const CustomerQueries = {
  findByEmail: async (email: string): Promise<Customer | null> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM customers WHERE email = $1',
        [email]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(error, 'Failed to find customer by email');
      throw error;
    }
  },

  findById: async (id: number): Promise<Customer | null> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM customers WHERE id = $1',
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(error, 'Failed to find customer by id');
      throw error;
    }
  },

  create: async (customer: Omit<Customer, 'id' | 'createdAt' | 'updatedAt'>): Promise<Customer> => {
    try {
      const result = await getPool().query(
        `INSERT INTO customers (email, first_name, last_name, phone, address,
         city, state, country, postal_code, preferred_region)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          customer.email,
          customer.firstName,
          customer.lastName,
          customer.phone,
          customer.address,
          customer.city,
          customer.state,
          customer.country,
          customer.postalCode,
          customer.preferredRegion,
        ]
      );
      return result.rows[0];
    } catch (error) {
      logger.error(error, 'Failed to create customer');
      throw error;
    }
  },

  update: async (id: number, updates: Partial<Customer>): Promise<Customer> => {
    try {
      const fields = Object.keys(updates)
        .map((key, i) => `${key} = $${i + 2}`)
        .join(', ');
      const values = Object.values(updates);

      const result = await getPool().query(
        `UPDATE customers SET ${fields}, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [id, ...values]
      );
      return result.rows[0];
    } catch (error) {
      logger.error(error, 'Failed to update customer');
      throw error;
    }
  },
};

// Property queries
export const PropertyQueries = {
  findById: async (id: number): Promise<Property | null> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM properties WHERE id = $1',
        [id]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(error, 'Failed to find property by id');
      throw error;
    }
  },

  searchByRegion: async (region: string): Promise<Property[]> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM properties WHERE region = $1 AND is_active = true',
        [region]
      );
      return result.rows;
    } catch (error) {
      logger.error(error, 'Failed to search properties by region');
      throw error;
    }
  },

  list: async (limit = 50, offset = 0): Promise<Property[]> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM properties WHERE is_active = true LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return result.rows;
    } catch (error) {
      logger.error(error, 'Failed to list properties');
      throw error;
    }
  },
};

// Booking queries
export const BookingQueries = {
  findByConfirmationCode: async (code: string): Promise<Booking | null> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM bookings WHERE confirmation_code = $1',
        [code]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(error, 'Failed to find booking');
      throw error;
    }
  },

  findByCustomerId: async (customerId: number): Promise<Booking[]> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM bookings WHERE customer_id = $1 ORDER BY created_at DESC',
        [customerId]
      );
      return result.rows;
    } catch (error) {
      logger.error(error, 'Failed to find bookings for customer');
      throw error;
    }
  },

  create: async (booking: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>): Promise<Booking> => {
    try {
      const result = await getPool().query(
        `INSERT INTO bookings (
          confirmation_code, property_id, customer_id, check_in_date, check_out_date,
          guest_count, total_nights, price_per_night, subtotal, fees, total_price,
          special_requests, status, payment_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          booking.confirmationCode,
          booking.propertyId,
          booking.customerId,
          booking.checkInDate,
          booking.checkOutDate,
          booking.guestCount,
          booking.totalNights,
          booking.pricePerNight,
          booking.subtotal,
          booking.fees,
          booking.totalPrice,
          booking.specialRequests,
          booking.status,
          booking.paymentStatus,
        ]
      );
      return result.rows[0];
    } catch (error) {
      logger.error(error, 'Failed to create booking');
      throw error;
    }
  },
};

// Call log queries
export const CallLogQueries = {
  create: async (callLog: Omit<CallLog, 'id' | 'createdAt'>): Promise<CallLog> => {
    try {
      const result = await getPool().query(
        `INSERT INTO call_logs (
          call_id, phone_number, incoming, intent, customer_id, booking_id,
          duration_seconds, escalated, escalation_reason, properties_shown, transcript, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *`,
        [
          callLog.callId,
          callLog.phoneNumber,
          callLog.incoming,
          callLog.intent,
          callLog.customerId,
          callLog.bookingId,
          callLog.durationSeconds,
          callLog.escalated,
          callLog.escalationReason,
          callLog.propertiesShown ? JSON.stringify(callLog.propertiesShown) : null,
          callLog.transcript,
          callLog.errorMessage,
        ]
      );
      return result.rows[0];
    } catch (error) {
      logger.error(error, 'Failed to create call log');
      throw error;
    }
  },

  findById: async (callId: string): Promise<CallLog | null> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM call_logs WHERE call_id = $1',
        [callId]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(error, 'Failed to find call log');
      throw error;
    }
  },
};
