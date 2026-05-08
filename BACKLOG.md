# Nova Voice Agent — Backlog

Items completed in the current session are **not** listed here. This file tracks
future work, ordered by priority tier.

---

## Tier 2 — Before Go-Live (~1 week)

- [ ] **Integration tests** — mock the Twilio WebSocket protocol and run full call
  scenarios end-to-end through `conversation-relay.ts` → `orchestrator.ts` → mock
  tools. Cover: new booking, existing reservation lookup, language switch, escalation.

- [ ] **Semantic / vector FAQ search** — replace keyword matching in
  `faq.service.ts` with pgvector + `text-embedding-3-small`. Add a `vector(1536)`
  column to the `faqs` table, embed at upsert time, cosine-similarity at query time.
  Handles synonyms, paraphrasing, and multi-language variants.

- [ ] **Post-call SMS to caller** — on `CallEnd` inside `conversation-relay.ts`,
  send a Twilio SMS to the caller's number summarising what was logged
  (reference #, next steps). Improves caller confidence and reduces repeat calls.

- [ ] **Booking confirmation loop** — clarify how staff finalise reservation
  interests logged in `intake_messages`. Options: Zapier/Make webhook → CRM,
  email to reservations team, or a simple staff dashboard action (see Tier 3).

- [ ] **Sanitise `.env.example`** — real API key and DB password are currently
  committed. Replace all values with `your_value_here` placeholders and rotate
  the exposed credentials.

---

## Tier 3 — First Month in Production

- [ ] **Staff operational dashboard** — simple Express-served HTML page showing:
  - Today's calls (time, intent, outcome, duration)
  - Pending intake queue (reservation interests, maintenance, service)
  - Recent escalations with transcript viewer
  - Key metrics (calls/day, resolution rate, escalation rate)

- [ ] **Voicemail / after-hours capture** — when `isBusinessHours()` returns false,
  offer caller the option to leave a voice message (Twilio `<Record>`). Store
  recording URL + transcript in `intake_messages`. Include in Slack notification.

- [ ] **Call quality scoring** — after each call, run a background job that asks
  Claude to score: resolution, accuracy, escalation necessity, tone. Store score
  in `call_logs`. Use to A/B test prompt changes over time.

- [ ] **Caller re-entry (resumable sessions)** — key session store on caller phone
  number (E.164) in addition to `CallSid`. On a new call within 30 min, offer to
  resume: "Were you calling about your reservation at [property]?"

- [ ] **Sentry integration** — wire `SENTRY_DSN` into an actual Sentry SDK init in
  `src/index.ts`. Currently the config key exists but nothing uses it.

- [ ] **Call recording storage** — Twilio records audio by default. Decide: store
  in S3 / Twilio cloud / discard. Add recording URL to `call_logs` for compliance
  and review.

---

## Tier 4 — Scale Features (1–3 months)

- [ ] **Outbound call campaigns** — add a `POST /voice/outbound` endpoint that
  accepts a guest phone + script type (pre-arrival, follow-up, confirmation) and
  initiates a Twilio outbound call. The agent architecture already handles the
  conversation; it just needs an initiator.

- [ ] **CRM sync** — when staff mark an intake request as resolved in the dashboard,
  sync the outcome back to Guesty as a note on the reservation. Closes the audit
  trail loop.

- [ ] **Property owner call persona** — owners calling to check on their property,
  report an issue, or ask about their payout is a distinct persona with its own
  tools and prompts. Fits the same ConversationRelay infrastructure.

- [ ] **Prompt caching observability** — `cacheReadTokens` / `cacheWriteTokens` are
  logged but not surfaced in metrics. Add to `/metrics` and the staff dashboard
  to track cost savings.

- [ ] **Consolidate DB layer** — move all inline queries from service files to
  `src/db/queries.ts` and implement `src/db/models.ts`. Not blocking, but reduces
  duplication as the query count grows.

- [ ] **Deployment config** — Dockerfile, docker-compose, and a deployment guide
  (Railway / Fly.io / AWS ECS). Required before handing to another developer or
  moving to a managed host.

- [ ] **Multi-tenant support** — if Nova adds more clients on the same platform,
  parameterise the config (business name, hours, voice IDs, Slack webhook) per
  tenant rather than per environment.
