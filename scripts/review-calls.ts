// Call review loop — analyzes calls and writes a markdown report.
//
//   npm run review                         all unreviewed calls
//   npm run review -- --call-id=CAxxx      one specific call
//   npm run review -- --since=2026-05-08   all calls since a date
//
// Output: docs/call-reviews/YYYY-MM-DD-HHmm-review.md  (gitignored)

import 'dotenv/config';
import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

const REVIEW_MODEL = process.env['REVIEW_MODEL'] ?? 'claude-sonnet-4-6';
const RENDER_API_KEY = process.env['RENDER_API_KEY'];
const RENDER_SERVICE_ID = process.env['RENDER_SERVICE_ID'];

// ─── Types ────────────────────────────────────────────────────────────────────

interface CallRow {
  call_id: string;
  phone_number: string | null;
  language: string | null;
  top_intent: string | null;
  duration_seconds: number | null;
  escalated: boolean | null;
  escalation_reason: string | null;
  error_message: string | null;
  created_at: Date;
  ended_at: Date | null;
}

interface InteractionRow {
  id: number;
  role: string;
  message: string | null;
  tool_called: string | null;
  tool_params: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
  created_at: Date;
}

interface CallFinding {
  severity: 'blocker' | 'annoyance' | 'cosmetic';
  description: string;
  root_cause: string;
  suggested_fix: string;
}

interface CallReview {
  call_id: string;
  summary: string;
  outcome: 'success' | 'partial' | 'failed';
  what_worked: string[];
  what_failed: CallFinding[];
  tags: string[];
}

interface Pattern {
  title: string;
  affects: string[];   // call_ids
  recommendation: string;
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const found = args.find((a) => a.startsWith(`--${k}=`));
  return found?.split('=').slice(1).join('=');
};

const onlyCallId = arg('call-id');
const sinceDate = arg('since');

// ─── DB ───────────────────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

const ask = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const r = await pool.query(sql, params);
  return r.rows as T[];
};

// ─── Render log fetch (best-effort) ───────────────────────────────────────────

const fetchRenderErrors = async (
  startTime: Date,
  endTime: Date,
): Promise<string[]> => {
  if (!RENDER_API_KEY || !RENDER_SERVICE_ID) return [];

  // 30s padding either side — call boundaries don't always align with log timestamps.
  const start = new Date(startTime.getTime() - 30_000).toISOString();
  const end = new Date(endTime.getTime() + 30_000).toISOString();

  const url =
    `https://api.render.com/v1/logs?ownerId=&resource=${RENDER_SERVICE_ID}` +
    `&startTime=${encodeURIComponent(start)}&endTime=${encodeURIComponent(end)}` +
    `&level=error&limit=50`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${RENDER_API_KEY}` },
    });
    if (!res.ok) {
      console.warn(`  ⚠️  Render API ${res.status} — skipping log enrichment`);
      return [];
    }
    const data = (await res.json()) as { logs?: Array<{ message: string }> };
    return (data.logs ?? []).map((l) => l.message).slice(0, 20);
  } catch (err) {
    console.warn(`  ⚠️  Render fetch failed (${(err as Error).message}) — continuing without`);
    return [];
  }
};

// ─── LLM analysis ─────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

const ANALYSIS_PROMPT = `You are reviewing a single voice-agent call to identify what worked, what failed, root causes, and concrete fixes.

The agent is "Nova Vacation Homes" — an AI handling inbound vacation rental calls. Architecture: Twilio ConversationRelay → Claude with tool-calling → Postgres FDW to a Guesty PMS. Key tools: classify_intent, verify_reservation, get_checkin_checkout_info, etc.

You will receive:
- Call metadata (duration, intent, escalation)
- Interaction log (user messages, assistant messages, tool calls + params + results)
- Runtime errors from the same time window (may be empty)

Return ONLY a JSON object matching this exact schema — no prose, no markdown fences:

{
  "summary": "one-sentence summary of what the caller wanted and how it ended",
  "outcome": "success" | "partial" | "failed",
  "what_worked": ["specific things the agent did right, e.g. 'two-factor enforcement was respected'"],
  "what_failed": [
    {
      "severity": "blocker" | "annoyance" | "cosmetic",
      "description": "specific failure observed in this call",
      "root_cause": "where in the system this happens — file/line if identifiable, or 'STT layer', 'prompt missing X', etc.",
      "suggested_fix": "concrete change a developer can act on"
    }
  ],
  "tags": ["short", "free-form", "labels", "for-clustering"]
}

Be terse. No filler. If nothing failed, "what_failed" is [].`;

const analyzeCall = async (
  call: CallRow,
  interactions: InteractionRow[],
  errors: string[],
): Promise<CallReview> => {
  const interactionLines = interactions.map((i) => {
    if (i.tool_called) {
      return `[tool] ${i.tool_called}(${JSON.stringify(i.tool_params)}) → ${JSON.stringify(i.tool_result)}`;
    }
    return `[${i.role}] ${(i.message ?? '').slice(0, 500)}`;
  }).join('\n');

  const userBlock = `## Call ${call.call_id}
- duration: ${call.duration_seconds}s
- phone: ${call.phone_number}
- top_intent: ${call.top_intent}
- escalated: ${call.escalated} (${call.escalation_reason ?? 'n/a'})
- error_message: ${call.error_message ?? 'n/a'}

## Interactions
${interactionLines || '(none)'}

## Runtime errors in window
${errors.length ? errors.map((e) => '- ' + e.slice(0, 400)).join('\n') : '(none)'}`;

  const resp = await anthropic.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 1500,
    system: ANALYSIS_PROMPT,
    messages: [{ role: 'user', content: userBlock }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Strip code fences if model added them despite the instruction
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');

  try {
    const parsed = JSON.parse(cleaned) as Omit<CallReview, 'call_id'>;
    return { call_id: call.call_id, ...parsed };
  } catch (err) {
    console.warn(`  ⚠️  Could not parse LLM output for ${call.call_id}: ${(err as Error).message}`);
    return {
      call_id: call.call_id,
      summary: '[review failed: could not parse LLM output]',
      outcome: 'failed',
      what_worked: [],
      what_failed: [],
      tags: ['review-failure'],
    };
  }
};

const findPatterns = async (reviews: CallReview[]): Promise<Pattern[]> => {
  if (reviews.length < 2) return [];

  const PATTERN_PROMPT = `You are scanning across multiple call reviews to find RECURRING failure patterns — issues that span 2+ calls.

Return ONLY a JSON array (no prose, no fences). Each pattern:

{
  "title": "short descriptive title",
  "affects": ["CAxxx", "CAyyy"],
  "recommendation": "one concrete next step"
}

Skip one-off issues. Empty array is fine.`;

  const userBlock = reviews.map((r) =>
    `### ${r.call_id} (${r.outcome})\nTags: ${r.tags.join(', ')}\nFailures: ${r.what_failed.map((f) => f.description).join(' | ')}`
  ).join('\n\n');

  const resp = await anthropic.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 1000,
    system: PATTERN_PROMPT,
    messages: [{ role: 'user', content: userBlock }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const cleaned = text.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');

  try {
    return JSON.parse(cleaned) as Pattern[];
  } catch {
    return [];
  }
};

// ─── Markdown render ──────────────────────────────────────────────────────────

const sevIcon = (s: CallFinding['severity']): string =>
  s === 'blocker' ? '🔴' : s === 'annoyance' ? '🟡' : '⚪';

const renderInteraction = (i: InteractionRow): string => {
  if (i.tool_called) {
    const params = JSON.stringify(i.tool_params ?? {});
    const resultPreview = JSON.stringify(i.tool_result ?? {}).slice(0, 200);
    return `   ${i.id}. \`${i.tool_called}\` ${params} → ${resultPreview}`;
  }
  return '';
};

const renderReport = (
  reviews: CallReview[],
  callsById: Map<string, CallRow>,
  interactionsByCall: Map<string, InteractionRow[]>,
  patterns: Pattern[],
): string => {
  const blockers = reviews.flatMap((r) => r.what_failed.filter((f) => f.severity === 'blocker')).length;
  const annoyances = reviews.flatMap((r) => r.what_failed.filter((f) => f.severity === 'annoyance')).length;
  const headerStamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

  const out: string[] = [];
  out.push(`# Call Review — ${headerStamp} (${reviews.length} calls · ${blockers} blockers · ${annoyances} annoyances)`);
  out.push('');

  if (patterns.length > 0) {
    out.push('## Recurring Patterns');
    patterns.forEach((p, idx) => {
      out.push(`${idx + 1}. **${p.title}** (calls: ${p.affects.join(', ')})`);
      out.push(`   - ${p.recommendation}`);
    });
    out.push('');
  }

  out.push('## Per-Call Findings');
  out.push('');

  for (const r of reviews) {
    const call = callsById.get(r.call_id);
    if (!call) continue;
    const phone = call.phone_number ?? 'unknown';
    const at = call.created_at.toISOString().replace('T', ' ').slice(0, 16);
    const dur = call.duration_seconds ?? '?';

    out.push(`### ${r.call_id} — ${at} — ${dur}s — ${phone}`);
    out.push(`**Outcome:** ${r.outcome}  `);
    out.push(`**Summary:** ${r.summary}`);
    out.push('');

    if (r.what_worked.length > 0) {
      out.push('**What worked**');
      r.what_worked.forEach((w) => out.push(`- ${w}`));
      out.push('');
    }

    if (r.what_failed.length > 0) {
      out.push('**What failed**');
      r.what_failed.forEach((f) => {
        out.push(`- ${sevIcon(f.severity)} **${f.severity}**: ${f.description}`);
        out.push(`  - Root cause: ${f.root_cause}`);
        out.push(`  - Suggested fix: ${f.suggested_fix}`);
      });
      out.push('');
    }

    const toolCalls = (interactionsByCall.get(r.call_id) ?? []).filter((i) => i.tool_called);
    if (toolCalls.length > 0) {
      out.push('**Tool calls**');
      toolCalls.forEach((i) => {
        const line = renderInteraction(i);
        if (line) out.push(line);
      });
      out.push('');
    }

    if (r.tags.length > 0) {
      out.push(`*Tags: ${r.tags.map((t) => '`' + t + '`').join(', ')}*`);
      out.push('');
    }
    out.push('---');
    out.push('');
  }

  return out.join('\n');
};

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    // Build the WHERE clause
    let where = 'WHERE ended_at IS NOT NULL';
    const params: unknown[] = [];
    if (onlyCallId) {
      where += ` AND call_id = $${params.length + 1}`;
      params.push(onlyCallId);
    } else if (sinceDate) {
      where += ` AND created_at >= $${params.length + 1}`;
      params.push(sinceDate);
    } else {
      where += ' AND reviewed_at IS NULL';
    }

    const calls = await ask<CallRow>(
      `SELECT call_id, phone_number, language, top_intent, duration_seconds,
              escalated, escalation_reason, error_message, created_at, ended_at
       FROM call_logs
       ${where}
       ORDER BY created_at ASC`,
      params,
    );

    if (calls.length === 0) {
      console.log('No calls match the filter — nothing to review. ✅');
      return;
    }

    console.log(`Reviewing ${calls.length} call(s)…`);

    const callsById = new Map(calls.map((c) => [c.call_id, c]));
    const interactionsByCall = new Map<string, InteractionRow[]>();
    const reviews: CallReview[] = [];

    for (const call of calls) {
      console.log(`  • ${call.call_id} (${call.duration_seconds}s)`);

      const interactions = await ask<InteractionRow>(
        `SELECT id, role, message, tool_called, tool_params, tool_result, created_at
         FROM agent_interactions
         WHERE call_id = $1
         ORDER BY id ASC`,
        [call.call_id],
      );
      interactionsByCall.set(call.call_id, interactions);

      const errors = call.ended_at
        ? await fetchRenderErrors(call.created_at, call.ended_at)
        : [];

      try {
        const review = await analyzeCall(call, interactions, errors);
        reviews.push(review);
      } catch (err) {
        console.warn(`    ⚠️  Analysis failed: ${(err as Error).message}`);
        // Don't mark this call reviewed — re-run will retry it.
      }
    }

    if (reviews.length === 0) {
      console.log('No reviews produced. Exiting.');
      return;
    }

    console.log('Looking for recurring patterns…');
    const patterns = await findPatterns(reviews);

    const reportDir = path.join(process.cwd(), 'docs', 'call-reviews');
    fs.mkdirSync(reportDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const reportPath = path.join(reportDir, `${stamp}-review.md`);
    fs.writeFileSync(reportPath, renderReport(reviews, callsById, interactionsByCall, patterns));

    // Mark reviewed calls — only the ones we successfully reviewed
    const reviewedIds = reviews
      .filter((r) => !r.tags.includes('review-failure'))
      .map((r) => r.call_id);
    if (reviewedIds.length > 0) {
      await pool.query(
        `UPDATE call_logs SET reviewed_at = NOW() WHERE call_id = ANY($1::text[])`,
        [reviewedIds],
      );
    }

    console.log(`\n✅ Report written to ${reportPath}`);
    console.log(`   ${reviews.length} reviews, ${patterns.length} pattern(s), ${reviewedIds.length} marked reviewed.`);
  } catch (err) {
    console.error('FAILED:', (err as Error).message);
    console.error((err as Error).stack);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
