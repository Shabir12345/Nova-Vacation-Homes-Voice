// ClientDbService — connects to the client's PostgreSQL database (schema: pms)
// Tables are PostgreSQL Foreign Data Wrappers proxying their Guesty PMS data.
//
// Read access:  pms.guest, pms.reservation, pms.listing,
//               pms.listing_marketing_info, pms.guestguide
// Write access: pms.call_log

import { Pool } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';
import { Cache } from '../utils/session-store';

// Full reservation snapshot — one DB hit at verify_reservation time covers every
// downstream Reservation Agent tool for the rest of the call. 30 min comfortably
// outlasts a normal call; if Guesty data changes mid-call (rare) the next call picks it up.
const RESERVATION_SNAPSHOT_TTL_S = 1800;
// Short TTL for legacy per-query caches — only hit on the cold path when the
// snapshot is missing (e.g. tool called before verify_reservation).
const LEGACY_QUERY_CACHE_TTL_S = 90;

const snapshotCacheKey = (reservationId: string): string => `reservation_full:${reservationId}`;

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

// Comprehensive snapshot stored in Redis after verify_reservation succeeds.
// Every Reservation Agent tool reads from this — no further DB calls during the call.
export interface ReservationFullSnapshot {
  // Reservation
  id: string;
  guestName: string;
  otaConfirmationCode: string | null;
  status: string;
  checkIn: Date;
  checkOut: Date;
  nightsCount: number;
  guestsCount: number;
  keyCode: string | null;
  // Guest
  guestEmail: string | null;
  // Listing
  listingId: string | null;
  propertyTitle: string;
  propertyNickname: string | null;
  propertyAddress: string;
  propertyCity: string | null;
  propertyState: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  accommodates: number | null;
  amenities: string[];
  areaSquareFeet: number | null;
  minimumAge: number | null;
  listingRooms: unknown;
  checkInTime: string;   // already formatted "4:00 PM"
  checkOutTime: string;
  wifiName: string | null;
  wifiPassword: string | null;
  // Marketing info (en)
  summary: string | null;
  space: string | null;
  neighborhood: string | null;
  houseRules: string | null;
  propertyNotes: string | null;
  accessInstructions: string | null;
}

// Reads the snapshot, rehydrating Date fields that JSON.stringify flattened.
const loadSnapshot = async (
  reservationId: string,
): Promise<ReservationFullSnapshot | null> => {
  const cached = await Cache.get<ReservationFullSnapshot>(snapshotCacheKey(reservationId)).catch(() => null);
  if (!cached) return null;
  return {
    ...cached,
    checkIn: new Date(cached.checkIn as unknown as string),
    checkOut: new Date(cached.checkOut as unknown as string),
  };
};

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

      const values: unknown[] = [];
      let idx = 1;

      // Two-factor verification: name MUST match AND a secondary identifier
      // (confirmation code or email) MUST match. Bug fix from prior version
      // which OR'd everything together — that let a request with a wrong
      // confirmation code still match on name alone.

      // Name predicate — substring match, with first+last fallback so
      // "John Smith" matches a stored "John A. Smith".
      const name = params.guestName.trim();
      const namePredicates: string[] = [];
      namePredicates.push(`LOWER(r.guest_full_name) LIKE LOWER($${idx++})`);
      values.push(`%${name}%`);

      const nameParts = name.split(/\s+/).filter(Boolean);
      if (nameParts.length >= 2) {
        const firstIdx = idx++;
        const lastIdx = idx++;
        namePredicates.push(
          `(LOWER(r.guest_full_name) LIKE LOWER($${firstIdx}) AND LOWER(r.guest_full_name) LIKE LOWER($${lastIdx}))`
        );
        values.push(`%${nameParts[0]}%`, `%${nameParts[nameParts.length - 1]}%`);
      }

      // Secondary identifier — at least one of confirmationCode / email is required.
      const idPredicates: string[] = [];
      if (params.confirmationCode) {
        idPredicates.push(`r.ota_confirmation_code = $${idx++}`);
        values.push(params.confirmationCode.trim().toUpperCase());
      }
      if (params.email) {
        idPredicates.push(`LOWER(g.email) = LOWER($${idx++})`);
        values.push(params.email.trim());
      }
      if (idPredicates.length === 0) {
        // verify_reservation enforces this upstream, but bail defensively if a
        // direct caller forgets to pass a second factor.
        logger.warn('findReservation called without confirmationCode or email — refusing name-only match');
        return null;
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
          l.id                       AS listing_id,
          l.title                    AS property_title,
          l.nickname                 AS property_nickname,
          l.full_address             AS property_address,
          l.city                     AS property_city,
          l.state                    AS property_state,
          l.bedrooms,
          l.bathrooms,
          l.accommodates,
          l.amenities,
          l.area_square_feet,
          l.minimum_age,
          l.listing_rooms,
          l.default_check_in_time    AS check_in_time,
          l.default_check_out_time   AS check_out_time,
          l.wifi_name,
          l.wifi_password,
          lm.summary,
          lm.space,
          lm.neighborhood,
          lm.house_rules,
          lm.notes                   AS property_notes,
          lm.access                  AS access_instructions,
          g.email                    AS guest_email
        FROM pms.reservation r
        LEFT JOIN pms.listing l                ON l.id = r.listing_id
        LEFT JOIN pms.listing_marketing_info lm ON lm.listing_id = l.id AND lm.language_code = 'en'
        LEFT JOIN pms.guest   g                ON g.id = r.guest_id
        WHERE r.reservation_status_code NOT IN ('cancelled', 'canceled', 'declined', 'expired')
          AND (${namePredicates.join(' OR ')})
          AND (${idPredicates.join(' OR ')})
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
        { found: result.rows.length > 0, hasCode: !!params.confirmationCode, hasEmail: !!params.email },
        'findReservation complete'
      );
      if (result.rows.length === 0) return null;

      const row = result.rows[0];

      // Build the comprehensive snapshot — this is what every downstream
      // Reservation Agent tool will read from for the rest of the call.
      const snapshot: ReservationFullSnapshot = {
        id: String(row.id),
        guestName: row.guest_full_name,
        otaConfirmationCode: row.ota_confirmation_code ?? null,
        status: row.reservation_status_code,
        checkIn: new Date(row.check_in),
        checkOut: new Date(row.check_out),
        nightsCount: row.nights_count,
        guestsCount: row.guestscount,
        keyCode: row.keycode ?? null,
        guestEmail: row.guest_email ?? null,
        listingId: row.listing_id ? String(row.listing_id) : null,
        propertyTitle: row.property_title ?? 'your property',
        propertyNickname: row.property_nickname ?? null,
        propertyAddress: row.property_address ?? '',
        propertyCity: row.property_city ?? null,
        propertyState: row.property_state ?? null,
        bedrooms: row.bedrooms ?? null,
        bathrooms: row.bathrooms ?? null,
        accommodates: row.accommodates ?? null,
        amenities: row.amenities ?? [],
        areaSquareFeet: row.area_square_feet ?? null,
        minimumAge: row.minimum_age ?? null,
        listingRooms: row.listing_rooms ?? null,
        checkInTime: row.check_in_time ? formatTime(row.check_in_time) : '4:00 PM',
        checkOutTime: row.check_out_time ? formatTime(row.check_out_time) : '10:00 AM',
        wifiName: row.wifi_name ?? null,
        wifiPassword: row.wifi_password ?? null,
        summary: row.summary ?? null,
        space: row.space ?? null,
        neighborhood: row.neighborhood ?? null,
        houseRules: row.house_rules ?? null,
        propertyNotes: row.property_notes ?? null,
        accessInstructions: row.access_instructions ?? null,
      };

      // Park the snapshot so subsequent tools can read it without another DB call.
      Cache.set(snapshotCacheKey(snapshot.id), snapshot, RESERVATION_SNAPSHOT_TTL_S).catch((err) =>
        logger.warn({ err }, 'Failed to cache reservation snapshot')
      );

      // Return the slim record the LLM and decision-engine expect.
      return {
        id: snapshot.id,
        guestName: snapshot.guestName,
        propertyTitle: snapshot.propertyTitle,
        propertyAddress: snapshot.propertyAddress,
        checkIn: snapshot.checkIn,
        checkOut: snapshot.checkOut,
        checkInTime: snapshot.checkInTime,
        checkOutTime: snapshot.checkOutTime,
        nightsCount: snapshot.nightsCount,
        guestsCount: snapshot.guestsCount,
        keyCode: snapshot.keyCode,
        wifiName: snapshot.wifiName,
        wifiPassword: snapshot.wifiPassword,
        otaConfirmationCode: snapshot.otaConfirmationCode,
        status: snapshot.status,
      };
    } catch (err) {
      logger.error({ err }, 'findReservation failed');
      throw err;
    } finally {
      client.release();
    }
  },

  // Full reservation + listing details for Reservation Agent questions.
  // Reads from the snapshot populated at verify_reservation time — no DB hit
  // unless the snapshot has expired or this is called before verification.
  getReservationDetails: async (reservationId: string): Promise<Record<string, unknown> | null> => {
    const snapshot = await loadSnapshot(reservationId);
    if (snapshot) return snapshot as unknown as Record<string, unknown>;

    // Cold path — snapshot missing. Hit DB once and prime the snapshot cache.
    const cacheKey = `reservation_details:${reservationId}`;
    const cached = await Cache.get<Record<string, unknown> | null>(cacheKey).catch(() => null);
    if (cached !== null) return cached;

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

      const row = result.rows[0] ?? null;
      // Cache misses too — repeated lookups for an unknown id should not pound the FDW
      Cache.set(cacheKey, row, LEGACY_QUERY_CACHE_TTL_S).catch((err) =>
        logger.warn({ err }, 'Failed to cache reservation details')
      );
      return row;
    } catch (err) {
      logger.error(err, 'getReservationDetails failed');
      throw err;
    }
  },

  // Check-in / check-out information — most common existing-guest question.
  // Served from snapshot when present (post-verify); falls back to DB otherwise.
  getCheckinInfo: async (reservationId: string): Promise<Record<string, unknown>> => {
    const snapshot = await loadSnapshot(reservationId);
    if (snapshot) {
      return {
        checkInDate: formatDate(snapshot.checkIn),
        checkOutDate: formatDate(snapshot.checkOut),
        checkInTime: snapshot.checkInTime,
        checkOutTime: snapshot.checkOutTime,
        propertyTitle: snapshot.propertyTitle,
        propertyAddress: snapshot.propertyAddress,
        keyCode: snapshot.keyCode,
        accessInstructions: snapshot.accessInstructions,
        wifiName: snapshot.wifiName,
        wifiPassword: snapshot.wifiPassword,
        otaConfirmationCode: snapshot.otaConfirmationCode,
      };
    }

    const cacheKey = `checkin_info:${reservationId}`;
    const cached = await Cache.get<Record<string, unknown>>(cacheKey).catch(() => null);
    if (cached) return cached;

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

      const info = {
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

      Cache.set(cacheKey, info, LEGACY_QUERY_CACHE_TTL_S).catch((err) =>
        logger.warn({ err }, 'Failed to cache checkin info')
      );
      return info;
    } catch (err) {
      logger.error(err, 'getCheckinInfo failed');
      throw err;
    }
  },

  // Listing details — amenities, description, house rules, etc.
  // Served from snapshot when present (post-verify); falls back to DB otherwise.
  getListingInfo: async (reservationId: string): Promise<Record<string, unknown>> => {
    const snapshot = await loadSnapshot(reservationId);
    if (snapshot) {
      return {
        title: snapshot.propertyTitle,
        nickname: snapshot.propertyNickname,
        full_address: snapshot.propertyAddress,
        city: snapshot.propertyCity,
        state: snapshot.propertyState,
        bedrooms: snapshot.bedrooms,
        bathrooms: snapshot.bathrooms,
        accommodates: snapshot.accommodates,
        amenities: snapshot.amenities,
        listing_rooms: snapshot.listingRooms,
        area_square_feet: snapshot.areaSquareFeet,
        minimum_age: snapshot.minimumAge,
        summary: snapshot.summary,
        space: snapshot.space,
        neighborhood: snapshot.neighborhood,
        house_rules: snapshot.houseRules,
        notes: snapshot.propertyNotes,
      };
    }

    const cacheKey = `listing_info:${reservationId}`;
    const cached = await Cache.get<Record<string, unknown>>(cacheKey).catch(() => null);
    if (cached) return cached;

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

      const row = result.rows[0] ?? {};
      Cache.set(cacheKey, row, LEGACY_QUERY_CACHE_TTL_S).catch((err) =>
        logger.warn({ err }, 'Failed to cache listing info')
      );
      return row;
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

  // Write a call log entry to the client's pms.call_log table.
  // Called at the end of every call regardless of call type —
  // reservation_id is NULL for non-guest calls (business inquiries, general info, etc.).
  // Note: 'call_catergory' column name is a typo in the client's PMS schema; do not rename.
  // The table is pms.call_log (singular) — the plural form does not exist.
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
        INSERT INTO pms.call_log
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
