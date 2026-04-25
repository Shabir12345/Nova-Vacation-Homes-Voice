import { StateMachine, ConversationContext } from '../state-machine';

describe('StateMachine', () => {
  let ctx: ConversationContext;

  beforeEach(() => {
    ctx = StateMachine.initialize('test-call-001');
  });

  describe('initialize', () => {
    it('creates context with GREETING state', () => {
      expect(ctx.state).toBe('GREETING');
      expect(ctx.callId).toBe('test-call-001');
      expect(ctx.intent).toBe('unknown');
      expect(ctx.messages).toHaveLength(0);
    });

    it('initializes all fields to null', () => {
      expect(ctx.customerEmail).toBeNull();
      expect(ctx.region).toBeNull();
      expect(ctx.checkInDate).toBeNull();
      expect(ctx.selectedPropertyId).toBeNull();
    });
  });

  describe('transition', () => {
    it('moves to GATHERING_INFO from INTENT_CLASSIFICATION', () => {
      ctx = StateMachine.transition(ctx, 'INTENT_CLASSIFICATION');
      ctx = StateMachine.transition(ctx, 'GATHERING_INFO');
      expect(ctx.state).toBe('GATHERING_INFO');
    });

    it('allows escalation from any state', () => {
      ctx = StateMachine.transition(ctx, 'SEARCHING');
      ctx = StateMachine.transition(ctx, 'ESCALATED');
      expect(ctx.state).toBe('ESCALATED');
    });
  });

  describe('addMessage', () => {
    it('appends messages immutably', () => {
      const updated = StateMachine.addMessage(ctx, 'user', 'Hello');
      expect(updated.messages).toHaveLength(1);
      expect(updated.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(ctx.messages).toHaveLength(0); // original unchanged
    });
  });

  describe('getMissingInfo', () => {
    it('returns all fields when nothing is set', () => {
      const missing = StateMachine.getMissingInfo(ctx);
      expect(missing).toContain('destination');
      expect(missing).toContain('check-in date');
      expect(missing).toContain('check-out date');
      expect(missing).toContain('number of guests');
    });

    it('returns empty when all search fields are set', () => {
      ctx = StateMachine.updateSearchCriteria(ctx, {
        region: 'Cancun',
        checkInDate: '2025-03-15',
        checkOutDate: '2025-03-22',
        guestCount: 4,
      });
      expect(StateMachine.getMissingInfo(ctx)).toHaveLength(0);
    });
  });

  describe('isReadyToSearch', () => {
    it('returns false when criteria incomplete', () => {
      expect(StateMachine.isReadyToSearch(ctx)).toBe(false);
    });

    it('returns true when all required criteria set', () => {
      ctx = StateMachine.updateSearchCriteria(ctx, {
        region: 'Cancun',
        checkInDate: '2025-03-15',
        checkOutDate: '2025-03-22',
        guestCount: 4,
      });
      expect(StateMachine.isReadyToSearch(ctx)).toBe(true);
    });
  });

  describe('isReadyToBook', () => {
    it('returns false when customer or property not set', () => {
      expect(StateMachine.isReadyToBook(ctx)).toBe(false);
    });
  });

  describe('trackPropertyShown', () => {
    it('adds properties without duplicates', () => {
      ctx = StateMachine.trackPropertyShown(ctx, [1, 2, 3]);
      ctx = StateMachine.trackPropertyShown(ctx, [2, 4]);
      expect(ctx.propertiesShown).toEqual([1, 2, 3, 4]);
    });
  });

  describe('escalate', () => {
    it('sets ESCALATED state and records reason', () => {
      ctx = StateMachine.escalate(ctx, 'payment_issue');
      expect(ctx.state).toBe('ESCALATED');
      expect(ctx.escalationReason).toBe('payment_issue');
    });
  });

  describe('confirmBooking', () => {
    it('sets CLOSED state and stores confirmation code', () => {
      ctx = StateMachine.confirmBooking(ctx, 'NVH-2025-1234');
      expect(ctx.state).toBe('CLOSED');
      expect(ctx.confirmedBookingCode).toBe('NVH-2025-1234');
    });
  });
});
