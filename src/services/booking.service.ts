// Booking service for creating, managing, and tracking reservations

import { getPool } from '../db/connection';
import { Booking } from '../db/models';
import { BookingQueries } from '../db/queries';
import { PropertyService } from './property.service';
import { logger } from '../utils/logger';

export interface CreateBookingParams {
  propertyId: number;
  customerId: number;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  guestCount: number;
  totalPrice: number;
  specialRequests?: string;
}

const generateConfirmationCode = (): string => {
  const random = Math.floor(Math.random() * 10000);
  return `NVH-${new Date().getFullYear()}-${random}`;
};

export const BookingService = {
  createBooking: async (params: CreateBookingParams): Promise<Booking> => {
    const client = await getPool().connect();

    try {
      await client.query('BEGIN');

      const {
        propertyId,
        customerId,
        checkInDate,
        checkOutDate,
        guestCount,
        totalPrice,
        specialRequests,
      } = params;

      // Verify property exists and is available
      const isAvailable = await PropertyService.checkAvailability(
        propertyId,
        checkInDate,
        checkOutDate
      );

      if (!isAvailable) {
        throw new Error('Property is not available for the selected dates');
      }

      // Calculate nights and pricing
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      const totalNights = Math.ceil(
        (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
      );
      const pricePerNight = totalPrice / totalNights - (totalPrice * 0.07) / totalNights;
      const subtotal = totalPrice * (1 - 0.07);
      const fees = totalPrice - subtotal;

      const confirmationCode = generateConfirmationCode();

      const result = await client.query(
        `INSERT INTO bookings (
          confirmation_code, property_id, customer_id, check_in_date, check_out_date,
          guest_count, total_nights, price_per_night, subtotal, fees, total_price,
          special_requests, status, payment_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          confirmationCode,
          propertyId,
          customerId,
          checkInDate,
          checkOutDate,
          guestCount,
          totalNights,
          pricePerNight,
          subtotal,
          fees,
          totalPrice,
          specialRequests || null,
          'confirmed',
          'pending',
        ]
      );

      // Mark dates as unavailable in availability calendar
      const dates = [];
      const current = new Date(checkInDate);
      while (current < checkOut) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }

      for (const date of dates) {
        await client.query(
          `INSERT INTO property_availability (property_id, date, is_available, reason)
           VALUES ($1, $2, false, 'booked')
           ON CONFLICT (property_id, date) DO UPDATE SET is_available = false, reason = 'booked'`,
          [propertyId, date]
        );
      }

      // Update customer booking count
      await client.query(
        'UPDATE customers SET total_bookings = total_bookings + 1 WHERE id = $1',
        [customerId]
      );

      await client.query('COMMIT');

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(error, 'Failed to create booking');
      throw error;
    } finally {
      client.release();
    }
  },

  getBookingByConfirmationCode: async (code: string): Promise<Booking | null> => {
    try {
      return await BookingQueries.findByConfirmationCode(code);
    } catch (error) {
      logger.error(error, 'Failed to get booking');
      throw error;
    }
  },

  getCustomerBookings: async (customerId: number): Promise<Booking[]> => {
    try {
      return await BookingQueries.findByCustomerId(customerId);
    } catch (error) {
      logger.error(error, 'Failed to get customer bookings');
      throw error;
    }
  },

  cancelBooking: async (confirmationCode: string, reason?: string): Promise<Booking> => {
    const client = await getPool().connect();

    try {
      await client.query('BEGIN');

      const booking = await BookingQueries.findByConfirmationCode(confirmationCode);
      if (!booking) {
        throw new Error(`Booking ${confirmationCode} not found`);
      }

      // Update booking status
      const result = await client.query(
        `UPDATE bookings SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
         WHERE confirmation_code = $1 RETURNING *`,
        [confirmationCode]
      );

      // Free up availability
      const checkIn = new Date(booking.checkInDate);
      const checkOut = new Date(booking.checkOutDate);
      const dates = [];
      const current = new Date(checkIn);

      while (current < checkOut) {
        dates.push(current.toISOString().split('T')[0]);
        current.setDate(current.getDate() + 1);
      }

      for (const date of dates) {
        await client.query(
          `UPDATE property_availability SET is_available = true, reason = $1
           WHERE property_id = $2 AND date = $3`,
          [reason || 'cancellation', booking.propertyId, date]
        );
      }

      await client.query('COMMIT');

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(error, 'Failed to cancel booking');
      throw error;
    } finally {
      client.release();
    }
  },
};
