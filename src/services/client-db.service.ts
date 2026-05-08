// ClientDbService — connects to the client's PostgreSQL database (schema: pms)
// Tables are PostgreSQL Foreign Data Wrappers proxying their Guesty PMS data.
//
// Read access:  pms.guest, pms.reservation, pms.listing,
//               pms.listing_marketing_info, pms.guestguide
// Write access: pms.call_log

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

let clientPool: Pool;

export const initializeClientDb = (): void => {
  if (!config.CLIENT_DATABASE_URL) {
    logger.warn('CLIENT_DATABASE_URL not set — client DB features unavailable');
    return;
  }

  clientPool = new Pool({
    connectionString: config.CLIENT_DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // All tables live in the pms schema
    options: '-c search_path=pms,public',
  });

  clientPool.on('error', (err) => logger.error(err, 'Client DB pool error'));
  logger.info('Client database pool initialised (schema: pms)');
};

const pool = (): Pool => {
  if (!clientPool) throw new Error('Client DB not initialised');
  return clientPool;
};

// ─── Normalised return types ──────────────────────────────────────────────────

export interface ReservationRecord {
  id: string;
  guestName: string;
  propertyTitle: string;
  propertyAddress: string;
  checkIn: Date;
  checkOut: Date;
  checkInTime: string;   // from listing.default_check_in_time
  checkOutTime: string;  // from listing.default_check_out_time
  nightsCount: number;
  guestsCount: number;
  keyCode: string | null;
  wifiName: string | null;
  wifiPassword: string | null;
  otaConfirmationCode: string | null;
  status: string;
}

export interface ListingSearchResult {
  id: string;
  title: string;
  nickname: string | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  accommodates: number | null;
  amenities: string[];
  checkInTime: string | null;
  checkOutTime: string | null;
  summary: string | null;
}

// ─── Reservation lookup — first step for every existing-guest call ────────────

export const ClientDbService = {
  findReservation: async (params: {
    guestName: string;
    email?: string;
    confirmationCode?: string;  // OTA confirmation code e.g. "HMZKYB34CX"
  }): Promise<ReservationRecord | null> => {
    const client = await pool().connect();
    try {
      // 10-second cap — FDW calls to Guesty can be slow on cold connections.
      await client.query("SET LOCAL statement_timeout = '10s'");

      const whereClauses: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (params.confirmationCode) {
        whereClauses.push(`r.ota_confirmation_code = $${idx++}`);
        values.push(params.confirmationCode.trim().toUpperCase());
      }

      if (params.email) {
        whereClauses.push(`LOWER(g.email) = LOWER($${idx++})`);
        values.push(params.email.trim());
      }

      // Full name substring match
      const name = params.guestName.trim();
      whereClauses.push(`LOWER(r.guest_full_name) LIKE LOWER($${idx++})`);
      values.push(`%${name}%`);

      // Word-by-word match — handles "John Smith" matching "John A. Smith" in DB.
      // Use pre-computed indices to avoid double-evaluation of idx++ in templates.
      const nameParts = name.split(/\s+/).filter(Boolean);
      if (nameParts.length >= 2) {
        const firstIdx = idx++;
        const lastIdx = idx++;
        whereClauses.push(
          `(LOWER(r.guest_full_name) LIKE LOWER($${firstIdx}) AND LOWER(r.guest_full_name) LIKE LOWER($${lastIdx}))`
        );
        values.push(`%${nameParts[0]}%`, `%${nameParts[nameParts.length - 1]}%`);
      }

      const sql = `
        SELECT
          r.id,
          r.guest_full_name,
          r.ota_confirmation_code,
          r.reservation_status_code,
          r.check_in,
          r.check_out,
          r.nights_count,
          r.guestscount,
          r.keycode,
          l.title                    AS property_title,
          l.full_address             AS property_address,
          l.default_check_in_time    AS check_in_time,
          l.default_check_out_time   AS check_out_time,
          l.wifi_name,
          l.wifi_password
        FROM pms.reservation r
        LEFT JOIN pms.listing l ON l.id = r.listing_id
        LEFT JOIN pms.guest   g ON g.id = r.guest_id
        WHERE r.reservation_status_code NOT IN ('cancelled', 'canceled', 'declined', 'expired')
          AND (${whereClauses.join(' OR ')})
        ORDER BY
          -- Prefer current stays, then upcoming, then most-recent past
          CASE
            WHEN r.check_in <= NOW() AND r.check_out >= NOW() THEN 0
            WHEN r.check_in > NOW() THEN 1
            ELSE 2
          END,
          ABS(EXTRACT(EPOCH FROM (r.check_in - NOW())))
        LIMIT 1
      `;

      const result = await client.query(sql, values);
      logger.debug(
        { found: result.rows.length > 0, conditions: whereClauses.length },
        'findReservation complete'
      );
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: String(row.id),
        guestName: row.guest_full_name,
        propertyTitle: row.property_title ?? 'Your property',
        propertyAddress: row.property_address ?? '',
        checkIn: new Date(row.check_in),
        checkOut: new Date(row.check_out),
        checkInTime: row.check_in_time
          ? formatTime(row.check_in_time)
          : '4:00 PM',
        checkOutTime: row.check_out_time
          ? formatTime(row.check_out_time)
          : '10:00 AM',
        nightsCount: row.nights_count,
        guestsCount: row.guestscount,
        keyCode: row.keycode ?? null,
        wifiName: row.wifi_name ?? null,
        wifiPassword: row.wifi_password ?? null,
        otaConfirmationCode: row.ota_confirmation_code ?? null,
        status: row.reservation_status_code,
      };
    } catch (err) {
      logger.error({ err }, 'findReservation failed');
      throw err;
    } finally {
      client.release();
    }
  },

  // Full reservation + listing details for Reservation Agent questions
  getReservationDetails: async (reservationId: string): Promise<Record<string, unknown> | null> => {
    try {
      const result = await pool().query(`
        SELECT
          r.*,
          l.title, l.full_address, l.city, l.state,
          l.bedrooms, l.bathrooms, l.accommodates,
          l.amenities, l.wifi_name, l.wifi_password,
          l.default_check_in_time, l.default_check_out_time,
          lm.access         AS access_instructions,
          lm.house_rules,
          lm.notes          AS property_notes,
          lm.summary        AS property_summary,
          lm.neighborhood
        FROM pms.reservation r
        LEFT JOIN pms.listing l              ON l.id = r.listing_id
        LEFT JOIN pms.listing_marketing_info lm ON lm.listing_id = l.id AND lm.language_code = 'en'
        WHERE r.id = $1
        LIMIT 1
      `, [reservationId]);

      return result.rows[0] ?? null;
    } catch (err) {
      logger.error(err, 'getReservationDetails failed');
      throw err;
    }
  },

  // Check-in / check-out information — most common existing-guest question
  getCheckinInfo: async (reservationId: string): Promise<Record<string, unknown>> => {
    try {
      const result = await pool().query(`
        SELECT
          r.check_in,
          r.check_out,
          r.nights_count,
          r.keycode,
          r.ota_confirmation_code,
          l.default_check_in_time,
          l.default_check_out_time,
          l.title           AS property_title,
          l.full_address    AS property_address,
          l.wifi_name,
          l.wifi_password,
          lm.access         AS access_instructions
        FROM pms.reservation r
        LEFT JOIN pms.listing l              ON l.id = r.listing_id
        LEFT JOIN pms.listing_marketing_info lm ON lm.listing_id = l.id AND lm.language_code = 'en'
        WHERE r.id = $1
      `, [reservationId]);

      if (result.rows.length === 0) return {};
      const row = result.rows[0];

      return {
        checkInDate: formatDate(row.check_in),
        checkOutDate: formatDate(row.check_out),
        checkInTime: row.default_check_in_time ? formatTime(row.default_check_in_time) : '4:00 PM',
        checkOutTime: row.default_check_out_time ? formatTime(row.default_check_out_time) : '10:00 AM',
        propertyTitle: row.property_title,
        propertyAddress: row.property_address,
        keyCode: row.keycode,
        accessInstructions: row.access_instructions,
        wifiName: row.wifi_name,
        wifiPassword: row.wifi_password,
        otaConfirmationCode: row.ota_confirmation_code,
      };
    } catch (err) {
      logger.error(err, 'getCheckinInfo failed');
      throw err;
    }
  },

  // Listing details — amenities, description, house rules, etc.
  getListingInfo: async (reservationId: string): Promise<Record<string, unknown>> => {
    try {
      const result = await pool().query(`
        SELECT
          l.title, l.nickname, l.full_address, l.city, l.state,
          l.bedrooms, l.bathrooms, l.accommodates,
          l.amenities,
          l.listing_rooms,
          l.area_square_feet,
          l.minimum_age,
          lm.summary, lm.space, lm.neighborhood, lm.house_rules, lm.notes
        FROM pms.reservation r
        JOIN pms.listing l ON l.id = r.listing_id
        LEFT JOIN pms.listing_marketing_info lm ON lm.listing_id = l.id AND lm.language_code = 'en'
        WHERE r.id = $1
      `, [reservationId]);

      return result.rows[0] ?? {};
    } catch (err) {
      logger.error(err, 'getListingInfo failed');
      throw err;
    }
  },

  // Guest guide entries for a reservation's listing — house manual, add-ons, etc.
  getGuestGuide: async (reservationId: string, language = 'en'): Promise<Record<string, unknown>[]> => {
    try {
      const result = await pool().query(`
        SELECT
          gg.title_i18n ->> $2            AS title,
          gg.short_description_i18n ->> $2 AS short_description,
          gg.content_i18n ->> $2           AS content,
          gg.category,
          gg.ui_tab_code,
          gg.ui_section_name,
          gg.is_purchasable,
          gg.unit_price,
          gg.unit_type
        FROM pms.reservation r
        JOIN pms.listing l    ON l.id = r.listing_id
        JOIN pms.guestguide gg ON (
          gg.filter_conditions IS NULL
          OR gg.filter_conditions -> 'listing_filter' -> 'id' -> 'value' ? CAST(l.id AS text)
        )
        WHERE r.id = $1
          AND gg.status = 'published'
        ORDER BY gg.ui_sequence_number NULLS LAST, gg.title
      `, [reservationId, language]);

      return result.rows;
    } catch (err) {
      logger.error(err, 'getGuestGuide failed');
      return [];
    }
  },

  // Property search for future guests / general info callers
  searchListings: async (params: {
    query?: string;
    city?: string;
    state?: string;
    minBedrooms?: number;
    maxGuests?: number;
  }): Promise<ListingSearchResult[]> => {
    try {
      const conditions: string[] = ['l.is_active = true', 'l.is_listed = true'];
      const values: unknown[] = [];
      let idx = 1;

      if (params.city) {
        conditions.push(`LOWER(l.city) LIKE LOWER($${idx++})`);
        values.push(`%${params.city}%`);
      }
      if (params.state) {
        // Pre-compute indices — two idx++ in one template literal is unreliable.
        const likeIdx = idx++;
        const eqIdx = idx++;
        conditions.push(`(LOWER(l.state) LIKE LOWER($${likeIdx}) OR LOWER(l.state) = LOWER($${eqIdx}))`);
        values.push(`%${params.state}%`, params.state);
      }
      if (params.minBedrooms) {
        conditions.push(`l.bedrooms >= $${idx++}`);
        values.push(params.minBedrooms);
      }
      if (params.maxGuests) {
        conditions.push(`l.accommodates >= $${idx++}`);
        values.push(params.maxGuests);
      }
      if (params.query) {
        const titleIdx = idx++;
        const addrIdx = idx++;
        conditions.push(`(LOWER(l.title) LIKE LOWER($${titleIdx}) OR LOWER(l.full_address) LIKE LOWER($${addrIdx}))`);
        values.push(`%${params.query}%`, `%${params.query}%`);
      }

      const result = await pool().query(`
        SELECT
          l.id, l.title, l.nickname, l.city, l.state,
          l.bedrooms, l.bathrooms, l.accommodates, l.amenities,
          l.default_check_in_time, l.default_check_out_time,
          lm.summary
        FROM pms.listing l
        LEFT JOIN pms.listing_marketing_info lm ON lm.listing_id = l.id AND lm.language_code = 'en'
        WHERE ${conditions.join(' AND ')}
        ORDER BY l.title
        LIMIT 10
      `, values);

      return result.rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        nickname: r.nickname,
        city: r.city,
        state: r.state,
        bedrooms: r.bedrooms,
        bathrooms: r.bathrooms,
        accommodates: r.accommodates,
        amenities: r.amenities ?? [],
        checkInTime: r.default_check_in_time ? formatTime(r.default_check_in_time) : null,
        checkOutTime: r.default_check_out_time ? formatTime(r.default_check_out_time) : null,
        summary: r.summary,
      }));
    } catch (err) {
      logger.error(err, 'searchListings failed');
      throw err;
    }
  },

  // Write a call log entry to the client's pms.call_logs table.
  // Called at the end of every call regardless of call type —
  // reservation_id is NULL for non-guest calls (business inquiries, general info, etc.).
  // Note: 'call_catergory' column name is a typo in the client's PMS schema; do not rename.
  writeCallLog: async (params: {
    callerName?: string | null;
    callerPhone?: string | null;
    callSummary: string;
    transcript: string;
    callCategory: string;
    reservationId?: string | null;
    checkIn?: Date | null;
    checkOut?: Date | null;
    escalated?: boolean;
  }): Promise<void> => {
    try {
      await pool().query(`
        INSERT INTO pms.call_logs
          (id, reservation_id, guest_name, phone, call_summary, transcript,
           call_catergory, check_in, check_out, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      `, [
        generateId(),
        params.reservationId ?? null,
        params.callerName ?? null,
        params.callerPhone ?? null,
        params.callSummary,
        params.transcript,
        params.callCategory,
        params.checkIn ?? null,
        params.checkOut ?? null,
      ]);
    } catch (err) {
      logger.error({ err }, 'writeCallLog failed');
      // Non-fatal — don't let a logging failure crash the call cleanup
    }
  },
};

// ─── ID generation ───────────────────────────────────────────────────────────
// pms.call_log.id has no sequence — generate a Snowflake-style bigint
// matching the format of existing IDs (timestamp-based, 19 digits)
// Max PostgreSQL bigint = 9,223,372,036,854,775,807 (~9.2e18)
// Date.now() * 1_000_000 ≈ 1.74e18 — safely within range
const generateId = (): bigint =>
  BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));

// ─── Formatting helpers ───────────────────────────────────────────────────────

// "16:00:00" → "4:00 PM"
const formatTime = (pgTime: string): string => {
  const [h, m] = pgTime.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

// Date → "Monday, July 24, 2025"
const formatDate = (d: Date | string): string =>
  new Date(d).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
