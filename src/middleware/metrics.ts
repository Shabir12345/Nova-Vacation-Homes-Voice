// In-process metrics tracking for call performance and agent behavior
// Counters and gauges are exposed via GET /metrics for scraping (Prometheus-compatible)

interface Counter { value: number; labels: Record<string, string> }

const counters: Record<string, Counter> = {};
const gauges: Record<string, number> = {};

const key = (name: string, labels?: Record<string, string>): string => {
  if (!labels || Object.keys(labels).length === 0) return name;
  const labelStr = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(',');
  return `${name}{${labelStr}}`;
};

export const Metrics = {
  increment: (name: string, labels?: Record<string, string>): void => {
    const k = key(name, labels);
    if (!counters[k]) counters[k] = { value: 0, labels: labels ?? {} };
    counters[k].value++;
  },

  gauge: (name: string, value: number): void => {
    gauges[name] = value;
  },

  snapshot: (): Record<string, unknown> => ({
    counters: Object.fromEntries(Object.entries(counters).map(([k, c]) => [k, c.value])),
    gauges,
    timestamp: new Date().toISOString(),
  }),

  // Named metrics used across the app
  callStarted: (): void => Metrics.increment('calls_started_total'),
  callEnded: (state: string): void => Metrics.increment('calls_ended_total', { final_state: state }),
  callEscalated: (reason: string): void => Metrics.increment('calls_escalated_total', { reason }),
  bookingCreated: (): void => Metrics.increment('bookings_created_total'),
  toolExecuted: (tool: string, success: boolean): void =>
    Metrics.increment('tool_executions_total', { tool, success: String(success) }),
  llmCallMade: (): void => Metrics.increment('llm_calls_total'),
  activeCalls: (count: number): void => Metrics.gauge('active_calls', count),
};
