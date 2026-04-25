// ClientDbService — read-only adapter to the client's existing PostgreSQL database
// Table names and column names will be filled in once the client shares their schema.
// All methods return normalised shapes that the agent tools can consume.

import { Pool } from 'pg';
import { logger } from '../utils/logger';

// Separate pool pointing at the CLIENT's database (read-only credentials)
let clientPool: Pool;

export const initializeClientDb = (): void => {
  const url = process.env.CLIENT_DATABASE_URL;
  if (!url) {
    logger.warn('CLIENT_DATABASE_URL not set — client DB features will return mock data');
    return;
  }
  clientPool = new Pool({ connectionString: url, max: 5 });
  logger.info('Client database pool initialised');
};

const getClientPool = (): Pool => {
  if (!clientPool) {
    throw new Error('Client database not initialised. Set CLIENT_DATABASE_URL.');
  }
  return clientPool;
};

// ─── Normalised types the agent consumes ─────────────────────────────────────

export interface ReservationRecord {
  id: string;
  guestName: string;
  propertyName: string;
  propertyAddress: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string;
  checkOutTime: string;
  guestCount: number;
  specialNotes: string | null;
}

export interface PropertySearchResult {
  name: string;
  region: string;
  description: string;
  bedrooms: number;
  maxGuests: number;
  priceRange: string;
  amenities: string[];
}

// ─── Methods ──────────────────────────────────────────────────────────────────

export const ClientDbService = {
  // Verify an existing guest reservation — called first for every existing-guest call
  findReservation: async (params: {
    guestName: string;
    email?: string;
    confirmationCode?: string;
  }): Promise<ReservationRecord | null> => {
    try {
      const pool = getClientPool();

      // TODO: Replace with actual client table/column names once schema is shared
      // Example query — update table name and columns to match client's schema:
      const query = `
        SELECT
          r.id,
          g.first_name || ' ' || g.last_name  AS guest_name,
          p.name                               AS property_name,
          p.address                            AS property_address,
          r.check_in_date,
          r.check_out_date,
          COALESCE(p.check_in_time, '3:00 PM') AS check_in_time,
          COALESCE(p.check_out_time, '11:00 AM') AS check_out_time,
          r.guest_count,
          r.special_notes
        FROM reservations r
        JOIN guests g ON r.guest_id = g.id
        JOIN properties p ON r.property_id = p.id
        WHERE (
          LOWER(g.first_name || ' ' || g.last_name) LIKE LOWER($1)
          ${params.email ? 'OR LOWER(g.email) = LOWER($2)' : ''}
          ${params.confirmationCode ? `OR r.confirmation_code = $${params.email ? 3 : 2}` : ''}
        )
        AND r.status NOT IN ('cancelled')
        ORDER BY r.check_in_date DESC
        LIMIT 1
      `;

      const queryParams: unknown[] = [`%${params.guestName}%`];
      if (params.email) queryParams.push(params.email);
      if (params.confirmationCode) queryParams.push(params.confirmationCode);

      const result = await pool.query(query, queryParams);

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        guestName: row.guest_name,
        propertyName: row.property_name,
        propertyAddress: row.property_address,
        checkInDate: row.check_in_date,
        checkOutDate: row.check_out_date,
        checkInTime: row.check_in_time,
        checkOutTime: row.check_out_time,
        guestCount: row.guest_count,
        specialNotes: row.special_notes,
      };
    } catch (error) {
      logger.error(error, 'Failed to find reservation in client DB');
      throw error;
    }
  },

  // General info about the reservation (dates, status, notes, etc.)
  getReservationInfo: async (reservationId: string, _question: string): Promise<Record<string, unknown>> => {
    try {
      const pool = getClientPool();
      // TODO: Replace with actual client table/column names
      const result = await pool.query(
        `SELECT r.*, p.name AS property_name, p.address, g.email, g.phone
         FROM reservations r
         JOIN properties p ON r.property_id = p.id
         JOIN guests g ON r.guest_id = g.id
         WHERE r.id = $1`,
        [reservationId]
      );
      return result.rows[0] ?? {};
    } catch (error) {
      logger.error(error, 'Failed to get reservation info');
      throw error;
    }
  },

  // Property/listing details for the reserved property
  getListingInfo: async (reservationId: string, _question: string): Promise<Record<string, unknown>> => {
    try {
      const pool = getClientPool();
      // TODO: Replace with actual client table/column names
      const result = await pool.query(
        `SELECT p.*
         FROM reservations r
         JOIN properties p ON r.property_id = p.id
         WHERE r.id = $1`,
        [reservationId]
      );
      return result.rows[0] ?? {};
    } catch (error) {
      logger.error(error, 'Failed to get listing info');
      throw error;
    }
  },

  // Check-in/check-out times and instructions
  getCheckinCheckoutInfo: async (reservationId: string): Promise<Record<string, unknown>> => {
    try {
      const pool = getClientPool();
      // TODO: Replace with actual client table/column names
      const result = await pool.query(
        `SELECT
          r.check_in_date, r.check_out_date,
          COALESCE(p.check_in_time, '3:00 PM') AS check_in_time,
          COALESCE(p.check_out_time, '11:00 AM') AS check_out_time,
          p.access_instructions,
          p.parking_instructions,
          p.wifi_password
         FROM reservations r
         JOIN properties p ON r.property_id = p.id
         WHERE r.id = $1`,
        [reservationId]
      );
      return result.rows[0] ?? {};
    } catch (error) {
      logger.error(error, 'Failed to get check-in/out info');
      throw error;
    }
  },

  // General property search for potential guests
  searchProperties: async (query: string, region?: string): Promise<PropertySearchResult[]> => {
    try {
      const pool = getClientPool();
      // TODO: Replace with actual client table/column names
      const result = await pool.query(
        `SELECT name, region, description, bedrooms, max_guests, base_price, amenities
         FROM properties
         WHERE is_active = true
           ${region ? "AND LOWER(region) LIKE LOWER($2)" : ''}
           AND (LOWER(name) LIKE LOWER($1) OR LOWER(description) LIKE LOWER($1) OR LOWER(region) LIKE LOWER($1))
         ORDER BY rating DESC
         LIMIT 5`,
        region ? [`%${query}%`, `%${region}%`] : [`%${query}%`]
      );

      return result.rows.map((r) => ({
        name: r.name,
        region: r.region,
        description: r.description,
        bedrooms: r.bedrooms,
        maxGuests: r.max_guests,
        priceRange: `From $${r.base_price}/night`,
        amenities: r.amenities ?? [],
      }));
    } catch (error) {
      logger.error(error, 'Failed to search properties in client DB');
      throw error;
    }
  },
};
