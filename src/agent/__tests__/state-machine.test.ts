import { StateMachine, ConversationContext } from '../state-machine';

describe('StateMachine', () => {
  let ctx: ConversationContext;

  beforeEach(() => {
    ctx = StateMachine.initialize('test-call-001');
  });

  // ── Initialization ──────────────────────────────────────────────────────────

  describe('initialize', () => {
    it('starts in GREETING state with master agent', () => {
      expect(ctx.state).toBe('GREETING');
      expect(ctx.activeAgent).toBe('master');
      expect(ctx.topIntent).toBe('unknown');
      expect(ctx.language).toBe('en');
    });

    it('initialises all nullable fields to null', () => {
      expect(ctx.callerName).toBeNull();
      expect(ctx.callerPhone).toBeNull();
      expect(ctx.reservation.reservationId).toBeNull();
      expect(ctx.reservation.confirmed).toBe(false);
      expect(ctx.escalationReason).toBeNull();
    });

    it('detects whether we are in business hours', () => {
      // isBusinessHours is a boolean — just verify it's set
      expect(typeof ctx.isBusinessHours).toBe('boolean');
    });
  });

  // ── State transitions ───────────────────────────────────────────────────────

  describe('transition', () => {
    it('follows the business inquiry branch', () => {
      ctx = StateMachine.transition(ctx, 'INTENT_CLASSIFICATION');
      ctx = StateMachine.transition(ctx, 'BUSINESS_INQUIRY_COLLECTING');
      ctx = StateMachine.transition(ctx, 'BUSINESS_INQUIRY_LOGGED');
      expect(ctx.state).toBe('BUSINESS_INQUIRY_LOGGED');
    });

    it('follows the existing guest branch to RESERVATION_AGENT', () => {
      ctx = StateMachine.transition(ctx, 'INTENT_CLASSIFICATION');
      ctx = StateMachine.transition(ctx, 'VERIFYING_RESERVATION');
      ctx = StateMachine.transition(ctx, 'EXISTING_GUEST_ROUTING');
      ctx = StateMachine.transition(ctx, 'RESERVATION_AGENT');
      expect(ctx.state).toBe('RESERVATION_AGENT');
    });

    it('follows the service agent branch', () => {
      ctx = StateMachine.transition(ctx, 'INTENT_CLASSIFICATION');
      ctx = StateMachine.transition(ctx, 'VERIFYING_RESERVATION');
      ctx = StateMachine.transition(ctx, 'EXISTING_GUEST_ROUTING');
      ctx = StateMachine.transition(ctx, 'SERVICE_AGENT');
      expect(ctx.state).toBe('SERVICE_AGENT');
    });

    it('allows ESCALATED from any state', () => {
      ctx = StateMachine.transition(ctx, 'SERVICE_AGENT');
      ctx = StateMachine.transition(ctx, 'ESCALATED');
      expect(ctx.state).toBe('ESCALATED');
    });
  });

  // ── Intent routing ──────────────────────────────────────────────────────────

  describe('setExistingGuestIntent', () => {
    it('routes cleaning to SERVICE_AGENT', () => {
      ctx = StateMachine.setExistingGuestIntent(ctx, 'cleaning');
      expect(ctx.activeAgent).toBe('service');
      expect(ctx.state).toBe('SERVICE_AGENT');
    });

    it('routes maintenance to SERVICE_AGENT', () => {
      ctx = StateMachine.setExistingGuestIntent(ctx, 'maintenance');
      expect(ctx.activeAgent).toBe('service');
    });

    it('routes general_information to RESERVATION_AGENT', () => {
      ctx = StateMachine.setExistingGuestIntent(ctx, 'general_information');
      expect(ctx.activeAgent).toBe('reservation');
      expect(ctx.state).toBe('RESERVATION_AGENT');
    });

    it('routes check_in_check_out to RESERVATION_AGENT', () => {
      ctx = StateMachine.setExistingGuestIntent(ctx, 'check_in_check_out');
      expect(ctx.activeAgent).toBe('reservation');
    });
  });

  describe('setFutureGuestIntent', () => {
    it('routes make_reservation to FUTURE_GUEST_RESERVATION', () => {
      ctx = StateMachine.setFutureGuestIntent(ctx, 'make_reservation');
      expect(ctx.state).toBe('FUTURE_GUEST_RESERVATION');
    });

    it('routes general_information to FUTURE_GUEST_INFO', () => {
      ctx = StateMachine.setFutureGuestIntent(ctx, 'general_information');
      expect(ctx.state).toBe('FUTURE_GUEST_INFO');
    });
  });

  // ── Language ────────────────────────────────────────────────────────────────

  describe('setLanguage', () => {
    it('updates language and preserves all other state', () => {
      ctx = StateMachine.addMessage(ctx, 'user', 'Hola');
      const updated = StateMachine.setLanguage(ctx, 'es');
      expect(updated.language).toBe('es');
      expect(updated.messages).toHaveLength(1); // preserved
    });
  });

  // ── Messages ────────────────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('appends messages immutably', () => {
      const updated = StateMachine.addMessage(ctx, 'user', 'Hello');
      expect(updated.messages).toHaveLength(1);
      expect(ctx.messages).toHaveLength(0); // original unchanged
    });

    it('preserves message order', () => {
      ctx = StateMachine.addMessage(ctx, 'user',      'Hello');
      ctx = StateMachine.addMessage(ctx, 'assistant', 'Hi there!');
      ctx = StateMachine.addMessage(ctx, 'user',      'I need help');
      expect(ctx.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    });
  });

  // ── Reservation ─────────────────────────────────────────────────────────────

  describe('setReservation', () => {
    it('merges reservation fields without wiping unrelated fields', () => {
      ctx = StateMachine.setReservation(ctx, { reservationId: 'res_001', confirmed: true });
      ctx = StateMachine.setReservation(ctx, { guestName: 'Jane Doe' });
      expect(ctx.reservation.reservationId).toBe('res_001');
      expect(ctx.reservation.guestName).toBe('Jane Doe');
      expect(ctx.reservation.confirmed).toBe(true);
    });
  });

  // ── Intake field tracking ───────────────────────────────────────────────────

  describe('getMissingIntakeFields', () => {
    it('reports all missing fields when caller info is empty', () => {
      const missing = StateMachine.getMissingIntakeFields(ctx);
      expect(missing).toContain('name');
      expect(missing).toContain('phone number');
      expect(missing).toContain('reason for calling');
    });

    it('returns empty when all intake fields are present', () => {
      ctx = StateMachine.setCallerInfo(ctx, { callerName: 'John', callerPhone: '555-1234' });
      ctx = StateMachine.updateIntake(ctx, { reason: 'general inquiry' });
      expect(StateMachine.getMissingIntakeFields(ctx)).toHaveLength(0);
    });
  });

  // ── Escalation & close ──────────────────────────────────────────────────────

  describe('escalate', () => {
    it('sets ESCALATED state and stores reason', () => {
      ctx = StateMachine.escalate(ctx, 'customer_request');
      expect(ctx.state).toBe('ESCALATED');
      expect(ctx.escalationReason).toBe('customer_request');
    });
  });

  describe('close', () => {
    it('sets state to CLOSED', () => {
      ctx = StateMachine.close(ctx);
      expect(ctx.state).toBe('CLOSED');
    });
  });

  describe('callDurationSeconds', () => {
    it('returns a non-negative number', () => {
      const duration = StateMachine.callDurationSeconds(ctx);
      expect(duration).toBeGreaterThanOrEqual(0);
    });
  });
});
