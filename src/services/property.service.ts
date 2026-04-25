// Property service for searching, filtering, and managing property data

import { getPool } from '../db/connection';
import { Property } from '../db/models';
import { logger } from '../utils/logger';

export interface SearchPropertiesParams {
  region: string;
  checkInDate: string; // YYYY-MM-DD
  checkOutDate: string; // YYYY-MM-DD
  guestCount: number;
  maxBudgetPerNight?: number;
  minBedrooms?: number;
  amenities?: string[];
}

export interface PropertySearchResult {
  id: number;
  name: string;
  region: string;
  pricePerNight: number;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  amenities?: string[];
  cancellationPolicy?: Record<string, unknown>;
  rating?: number;
  imageUrl?: string;
}

export const PropertyService = {
  searchProperties: async (params: SearchPropertiesParams): Promise<PropertySearchResult[]> => {
    try {
      const {
        region,
        checkInDate,
        checkOutDate,
        guestCount,
        maxBudgetPerNight,
        minBedrooms,
        amenities,
      } = params;

      let query = `
        SELECT DISTINCT p.id, p.name, p.region, p.base_price_per_night, p.bedrooms,
               p.bathrooms, p.max_guests, p.amenities, p.cancellation_policy, p.rating
        FROM properties p
        WHERE p.region = $1
          AND p.is_active = true
          AND p.max_guests >= $2
          AND NOT EXISTS (
            SELECT 1 FROM property_availability pa
            WHERE pa.property_id = p.id
              AND pa.date BETWEEN $3 AND $4
              AND pa.is_available = false
          )
      `;

      const queryParams: unknown[] = [region, guestCount, checkInDate, checkOutDate];
      let paramIndex = 5;

      if (maxBudgetPerNight) {
        query += ` AND p.base_price_per_night <= $${paramIndex}`;
        queryParams.push(maxBudgetPerNight);
        paramIndex++;
      }

      if (minBedrooms) {
        query += ` AND p.bedrooms >= $${paramIndex}`;
        queryParams.push(minBedrooms);
        paramIndex++;
      }

      query += ' ORDER BY p.rating DESC, p.base_price_per_night ASC';

      const result = await getPool().query(query, queryParams);

      const properties = result.rows as PropertySearchResult[];

      // Filter by amenities if provided (client-side for simplicity)
      if (amenities && amenities.length > 0) {
        return properties.filter((prop) => {
          const propAmenities = prop.amenities || [];
          return amenities.some((amenity) => propAmenities.includes(amenity));
        });
      }

      return properties;
    } catch (error) {
      logger.error(error, 'Failed to search properties');
      throw error;
    }
  },

  getPropertyDetails: async (propertyId: number): Promise<Property | null> => {
    try {
      const result = await getPool().query(
        'SELECT * FROM properties WHERE id = $1',
        [propertyId]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(error, 'Failed to get property details');
      throw error;
    }
  },

  checkAvailability: async (
    propertyId: number,
    checkInDate: string,
    checkOutDate: string
  ): Promise<boolean> => {
    try {
      const result = await getPool().query(
        `SELECT COUNT(*) FROM property_availability
         WHERE property_id = $1
           AND date BETWEEN $2 AND $3
           AND is_available = false`,
        [propertyId, checkInDate, checkOutDate]
      );

      const unavailableDays = parseInt(result.rows[0].count, 10);
      return unavailableDays === 0;
    } catch (error) {
      logger.error(error, 'Failed to check availability');
      throw error;
    }
  },

  getAvailabilityAndPricing: async (
    propertyId: number,
    checkInDate: string,
    checkOutDate: string
  ): Promise<{ available: boolean; totalPrice: number; breakdown: Record<string, unknown> }> => {
    try {
      const property = await PropertyService.getPropertyDetails(propertyId);
      if (!property) {
        throw new Error(`Property ${propertyId} not found`);
      }

      const available = await PropertyService.checkAvailability(
        propertyId,
        checkInDate,
        checkOutDate
      );

      // Calculate number of nights
      const checkIn = new Date(checkInDate);
      const checkOut = new Date(checkOutDate);
      const nights = Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));

      // Get pricing from availability table if override exists
      const priceResult = await getPool().query(
        `SELECT COALESCE(AVG(COALESCE(price_override, $1)), $1) as avg_price
         FROM property_availability
         WHERE property_id = $2
           AND date BETWEEN $3 AND $4`,
        [property.basePricePerNight, propertyId, checkInDate, checkOutDate]
      );

      const pricePerNight = parseFloat(priceResult.rows[0].avg_price);
      const subtotal = pricePerNight * nights;
      const fees = Math.round(subtotal * 0.07 * 100) / 100; // 7% fees
      const totalPrice = subtotal + fees;

      return {
        available,
        totalPrice,
        breakdown: {
          nights,
          pricePerNight,
          subtotal,
          fees,
          currency: 'USD',
        },
      };
    } catch (error) {
      logger.error(error, 'Failed to get availability and pricing');
      throw error;
    }
  },
};
