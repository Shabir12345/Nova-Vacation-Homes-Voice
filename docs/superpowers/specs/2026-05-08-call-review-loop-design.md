# Call Review Loop — Design

**Date:** 2026-05-08
**Status:** Approved (in conversation), ready to implement

## Goal

After we run a batch of calls, we need a single command that compiles what went well, what went wrong, the root causes, and concrete fix suggestions — so we can iterate the prompt, the tools, and the code on a tight feedback loop instead of grepping logs by hand.

## User Story

> As the operator, I make some test calls. When I'm ready to review, I run `npm run review`. The script analyzes every call that hasn't been reviewed yet and writes a markdown report I can read on my laptop. The report tells me what worked, what failed, what's recurring, and exactly what to ask the agent (Claude in the editor) to fix.

## Non-Goals

- **Not real-time / per-call.** No automatic analysis on call end. Operator triggers it.
- **Not auto-fixing code.** The report suggests fixes; the operator decides what to apply.
- **Not a dashboard.** Markdown only. No web UI, no DB analytics queries.

## Trigger

```
npm run review                  # all unreviewed calls
npm run review -- --call-id=CAxxx  # one specific call (re-reviews it)
npm run review -- --since=2026-05-08  # all calls since a date
```

Default scope: every call in `call_logs` whose `reviewed_at` is NULL.

## Pipeline

For each call selected:

1. **Gather call context from our DB**
   - `call_logs` row: call_id, phone_number, language, top_intent, duration, escalated, escalation_reason, error_message, created_at, ended_at
   - `agent_interactions` rows ordered by id: role, message, tool_called, tool_params, tool_result

2. **Pull runtime errors from Render** (best-effort)
   - Use the Render REST API (`RENDER_API_KEY`, `RENDER_SERVICE_ID` env vars) to fetch app logs in `[call.created_at - 30s, call.ended_at + 30s]`, filtered to `level=error`
   - Pass any matching errors as additional context to the LLM

3. **Per-call LLM analysis**
   - Model: `claude-sonnet-4-6` (configurable via `REVIEW_MODEL` env var)
   - Prompt: structured-output instructions that yield JSON matching this schema:
     ```ts
     {
       summary: string;            // 1 sentence
       outcome: 'success' | 'partial' | 'failed';
       what_worked: string[];
       what_failed: Array<{
         severity: 'blocker' | 'annoyance' | 'cosmetic';
         description: string;
         root_cause: string;       // includes file/line where identifiable
         suggested_fix: string;    // concrete enough to act on
       }>;
       tags: string[];             // free-form, e.g. "stt-mishearing", "code-truncation"
     }
     ```

4. **Aggregate pass** (single extra LLM call across all per-call findings)
   - Cluster `tags` and `what_failed.description` to surface recurring patterns
   - Returns ordered list of patterns with the calls each pattern affects

5. **Render markdown** to `docs/call-reviews/YYYY-MM-DD-HHmm-review.md`

6. **Mark reviewed** — `UPDATE call_logs SET reviewed_at = NOW() WHERE call_id IN (...)`

## Markdown Report Layout

```markdown
# Call Review — 2026-05-08 14:30 (3 calls · 1 blocker · 2 annoyances)

## Recurring Patterns
1. **STT misheard letters in confirmation codes** (calls: CAxxx, CAyyy)
   - S↔5 confusion specifically. Fix: prompts.ts already updated; consider OCR-style normalization.

## Per-Call Findings

### CAxxx — 2026-05-08 16:40 — 76s — phone +1361...
**Outcome:** failed
**Summary:** Caller wanted to confirm reservation; lookup failed twice with truncated codes.

**What worked**
- Two-factor enforcement
- Graceful retry messaging

**What failed**
- 🔴 **blocker**: Agent submitted `HM3H458` (6 chars) before the caller finished the code
  - Root cause: prompts.ts didn't require waiting for full code or reading back
  - Suggested fix: Add explicit "wait for full code, read back letter-by-letter" rule (✅ done)

**Tool calls**
1. `classify_intent` → existing_guest
2. `verify_reservation` { caller_name: "Sean Shaw", confirmation_code: "HM3H458" } → not found
3. `verify_reservation` { caller_name: "Sean Shaw", confirmation_code: "HM3H42SFX5" } → not found
```

(No verbatim transcript in the file — re-query the DB if needed.)

## Files

| File | Purpose |
|------|---------|
| `scripts/review-calls.ts` | The command implementation |
| `src/db/migrations/00X-add-reviewed-at.sql` | Adds `reviewed_at TIMESTAMPTZ NULL` to `call_logs` |
| `package.json` | New script: `"review": "ts-node --transpile-only scripts/review-calls.ts"` |
| `.gitignore` | Adds `docs/call-reviews/` |
| `docs/call-reviews/.gitkeep` | Folder is gitignored except the keep file |

## Privacy

- Reports contain caller phone numbers, names, partial confirmation codes — caller PII. Folder is gitignored so reports stay on the operator's machine.
- DB stores everything as before (no change).
- LLM calls send transcript content to Anthropic (already true for the live agent).

## Failure Modes

- **No Render API key** → skip log enrichment, log a warning, continue with DB-only analysis.
- **LLM call fails for one call** → mark that call's report section as `[review failed: <error>]`, continue with the others. Don't set `reviewed_at` for failed ones so a re-run picks them up.
- **No unreviewed calls** → print a friendly message and exit 0.

## Cost

~$0.02–$0.10 per call analyzed at Sonnet 4.6 pricing (≈5K input tokens per call). At current volume, negligible.

## Open Questions

None. All design decisions confirmed in conversation.
