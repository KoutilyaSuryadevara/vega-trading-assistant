// CostGovernor — centralized cost control for ALL Claude API calls

import crypto from 'crypto';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger';

// ─── Pricing constants (claude-sonnet-4-6) ────────────────────────────────────
const COST_PER_INPUT_TOKEN = 3.00 / 1_000_000;    // $3.00/1M
const COST_PER_OUTPUT_TOKEN = 15.00 / 1_000_000;   // $15.00/1M
const COST_PER_CACHE_WRITE = 3.75 / 1_000_000;     // $3.75/1M (25% more than input)
const COST_PER_CACHE_READ = 0.30 / 1_000_000;      // $0.30/1M (90% cheaper than input)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AiUsageEvent {
  id: string;
  provider: string;         // 'anthropic'
  model: string;            // 'claude-sonnet-4-6'
  endpoint: string;         // 'chat' | 'health' | 'monitor' | etc.
  session_id?: string;
  reason: string;           // human description of why Claude was called
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  cache_hit: boolean;       // response came from local cache
  blocked_by_budget: boolean;
  created_at: string;
}

// ─── CostGovernor ─────────────────────────────────────────────────────────────

export class CostGovernor {
  private db: Database.Database;

  // Config from env (with defaults)
  private readonly dailyBudget: number;
  private readonly monthlyBudget: number;
  private readonly maxCallsPerHour: number;
  private readonly maxTokensPerRequest: number;
  private readonly maxOutputTokens: number;
  private readonly enabled: boolean;
  private readonly cacheTtlSeconds: number;

  constructor(db: Database.Database) {
    this.db = db;

    this.dailyBudget = parseFloat(process.env.CLAUDE_DAILY_BUDGET_USD ?? '5');
    this.monthlyBudget = parseFloat(process.env.CLAUDE_MONTHLY_BUDGET_USD ?? '100');
    this.maxCallsPerHour = parseInt(process.env.CLAUDE_MAX_CALLS_PER_HOUR ?? '20', 10);
    this.maxTokensPerRequest = parseInt(process.env.CLAUDE_MAX_TOKENS_PER_REQUEST ?? '4000', 10);
    this.maxOutputTokens = parseInt(process.env.CLAUDE_MAX_OUTPUT_TOKENS ?? '800', 10);
    this.enabled = process.env.CLAUDE_ENABLED !== 'false';
    this.cacheTtlSeconds = parseInt(process.env.CLAUDE_CACHE_TTL_SECONDS ?? '3600', 10);

    this.initSchema();
    logger.info('CostGovernor initialized', {
      dailyBudget: this.dailyBudget,
      monthlyBudget: this.monthlyBudget,
      maxCallsPerHour: this.maxCallsPerHour,
      enabled: this.enabled,
    });
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage_events (
        id                  TEXT PRIMARY KEY,
        provider            TEXT NOT NULL DEFAULT 'anthropic',
        model               TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
        endpoint            TEXT NOT NULL,
        session_id          TEXT,
        reason              TEXT NOT NULL,
        prompt_tokens       INTEGER NOT NULL DEFAULT 0,
        completion_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        total_tokens        INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd  REAL NOT NULL DEFAULT 0,
        cache_hit           INTEGER NOT NULL DEFAULT 0,
        blocked_by_budget   INTEGER NOT NULL DEFAULT 0,
        created_at          TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS response_cache (
        prompt_hash  TEXT PRIMARY KEY,
        response     TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        ttl_seconds  INTEGER NOT NULL DEFAULT 3600
      );
    `);
  }

  // ── Budget / rate checks ───────────────────────────────────────────────────

  canCall(endpoint: string): { allowed: boolean; reason: string } {
    if (!this.enabled) {
      return { allowed: false, reason: 'Claude API is disabled (CLAUDE_ENABLED=false)' };
    }

    // Check daily budget
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyRow = this.db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) as spend
      FROM ai_usage_events
      WHERE created_at >= ? AND blocked_by_budget = 0
    `).get(todayStart.toISOString()) as { spend: number };

    const dailySpend = dailyRow.spend;
    if (dailySpend >= this.dailyBudget) {
      return {
        allowed: false,
        reason: `Daily budget $${this.dailyBudget.toFixed(2)} exceeded. Spend: $${dailySpend.toFixed(2)}`,
      };
    }

    // Check monthly budget
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthlyRow = this.db.prepare(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0) as spend
      FROM ai_usage_events
      WHERE created_at >= ? AND blocked_by_budget = 0
    `).get(monthStart.toISOString()) as { spend: number };

    const monthlySpend = monthlyRow.spend;
    if (monthlySpend >= this.monthlyBudget) {
      return {
        allowed: false,
        reason: `Monthly budget $${this.monthlyBudget.toFixed(2)} exceeded. Spend: $${monthlySpend.toFixed(2)}`,
      };
    }

    // Check hourly call rate
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const hourlyRow = this.db.prepare(`
      SELECT COUNT(*) as calls
      FROM ai_usage_events
      WHERE created_at >= ? AND cache_hit = 0 AND blocked_by_budget = 0
    `).get(hourAgo) as { calls: number };

    if (hourlyRow.calls >= this.maxCallsPerHour) {
      return {
        allowed: false,
        reason: `Hourly call limit (${this.maxCallsPerHour}) reached. ${hourlyRow.calls} calls in last 60 min.`,
      };
    }

    logger.debug('CostGovernor: call allowed', {
      endpoint,
      dailySpend: dailySpend.toFixed(4),
      dailyBudget: this.dailyBudget,
      hourlyCalls: hourlyRow.calls,
    });

    return { allowed: true, reason: 'ok' };
  }

  // ── Usage recording ────────────────────────────────────────────────────────

  recordUsage(event: Omit<AiUsageEvent, 'id' | 'created_at'>): void {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO ai_usage_events
        (id, provider, model, endpoint, session_id, reason,
         prompt_tokens, completion_tokens, cache_read_tokens, cache_write_tokens,
         total_tokens, estimated_cost_usd, cache_hit, blocked_by_budget, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.provider ?? 'anthropic',
      event.model ?? 'claude-sonnet-4-6',
      event.endpoint,
      event.session_id ?? null,
      event.reason,
      event.prompt_tokens,
      event.completion_tokens,
      event.cache_read_tokens,
      event.cache_write_tokens,
      event.total_tokens,
      event.estimated_cost_usd,
      event.cache_hit ? 1 : 0,
      event.blocked_by_budget ? 1 : 0,
      now,
    );

    logger.info('AI usage recorded', {
      endpoint: event.endpoint,
      reason: event.reason,
      cost: `$${event.estimated_cost_usd.toFixed(6)}`,
      tokens: event.total_tokens,
      cacheHit: event.cache_hit,
      blocked: event.blocked_by_budget,
    });
  }

  // ── Cost estimation ────────────────────────────────────────────────────────

  estimateCost(
    promptTokens: number,
    completionTokens: number,
    cacheReadTokens = 0,
    cacheWriteTokens = 0,
  ): number {
    return (
      promptTokens * COST_PER_INPUT_TOKEN +
      completionTokens * COST_PER_OUTPUT_TOKEN +
      cacheReadTokens * COST_PER_CACHE_READ +
      cacheWriteTokens * COST_PER_CACHE_WRITE
    );
  }

  // ── Response cache ─────────────────────────────────────────────────────────

  getCachedResponse(promptHash: string): string | null {
    const row = this.db.prepare(`
      SELECT response, created_at, ttl_seconds
      FROM response_cache
      WHERE prompt_hash = ?
    `).get(promptHash) as { response: string; created_at: string; ttl_seconds: number } | undefined;

    if (!row) return null;

    const age = (Date.now() - new Date(row.created_at).getTime()) / 1000;
    if (age > row.ttl_seconds) {
      // Expired — clean it up
      this.db.prepare('DELETE FROM response_cache WHERE prompt_hash = ?').run(promptHash);
      return null;
    }

    // Record cache hit (zero cost)
    this.recordUsage({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      endpoint: 'cache',
      reason: 'response-cache-hit',
      prompt_tokens: 0,
      completion_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      cache_hit: true,
      blocked_by_budget: false,
    });

    return row.response;
  }

  setCachedResponse(promptHash: string, response: string, ttlSeconds?: number): void {
    const ttl = ttlSeconds ?? this.cacheTtlSeconds;
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO response_cache (prompt_hash, response, created_at, ttl_seconds)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(prompt_hash) DO UPDATE
        SET response = excluded.response,
            created_at = excluded.created_at,
            ttl_seconds = excluded.ttl_seconds
    `).run(promptHash, response, now, ttl);
  }

  hashPrompt(systemPromptVersion: string, messages: unknown[], contextHash: string): string {
    const normalized = JSON.stringify({ v: systemPromptVersion, msgs: messages, ctx: contextHash });
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  getDailyStats(): {
    spend: number;
    calls: number;
    cachedCalls: number;
    blockedCalls: number;
    avgTokens: number;
  } {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = todayStart.toISOString();

    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(estimated_cost_usd), 0) as spend,
        COUNT(*) as calls,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cached_calls,
        SUM(CASE WHEN blocked_by_budget = 1 THEN 1 ELSE 0 END) as blocked_calls,
        COALESCE(AVG(CASE WHEN cache_hit = 0 AND blocked_by_budget = 0 THEN total_tokens END), 0) as avg_tokens
      FROM ai_usage_events
      WHERE created_at >= ?
    `).get(since) as {
      spend: number;
      calls: number;
      cached_calls: number;
      blocked_calls: number;
      avg_tokens: number;
    };

    return {
      spend: row.spend,
      calls: row.calls,
      cachedCalls: row.cached_calls,
      blockedCalls: row.blocked_calls,
      avgTokens: Math.round(row.avg_tokens),
    };
  }

  getMonthlyStats(): { spend: number; calls: number } {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(estimated_cost_usd), 0) as spend,
        COUNT(*) as calls
      FROM ai_usage_events
      WHERE created_at >= ? AND blocked_by_budget = 0
    `).get(monthStart.toISOString()) as { spend: number; calls: number };

    return { spend: row.spend, calls: row.calls };
  }

  getTopEndpoints(limit = 5): Array<{ endpoint: string; calls: number; spend: number }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const rows = this.db.prepare(`
      SELECT endpoint, COUNT(*) as calls, COALESCE(SUM(estimated_cost_usd), 0) as spend
      FROM ai_usage_events
      WHERE created_at >= ?
      GROUP BY endpoint
      ORDER BY spend DESC
      LIMIT ?
    `).all(todayStart.toISOString(), limit) as Array<{ endpoint: string; calls: number; spend: number }>;

    return rows;
  }

  getCacheHitRate(): number {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as hits
      FROM ai_usage_events
      WHERE created_at >= ?
    `).get(todayStart.toISOString()) as { total: number; hits: number };

    if (row.total === 0) return 0;
    return Math.round((row.hits / row.total) * 100);
  }

  getStatusMessage(): string {
    const daily = this.getDailyStats();
    const pct = (daily.spend / this.dailyBudget) * 100;

    if (!this.enabled) {
      return '✗ AI disabled (CLAUDE_ENABLED=false). Using local/cached responses.';
    }
    if (pct >= 100) {
      return `✗ AI daily budget exceeded ($${daily.spend.toFixed(2)}/$${this.dailyBudget.toFixed(2)}). Using cached/local responses.`;
    }
    if (pct >= 85) {
      return `⚠ AI daily budget at ${pct.toFixed(0)}%. $${daily.spend.toFixed(2)}/$${this.dailyBudget.toFixed(2)}. Non-critical AI paused.`;
    }
    return `✓ AI budget nominal. $${daily.spend.toFixed(2)}/$${this.dailyBudget.toFixed(2)} today (${pct.toFixed(0)}%). ${daily.calls} calls today.`;
  }

  // Expose config values for the cost route
  get config() {
    return {
      dailyBudget: this.dailyBudget,
      monthlyBudget: this.monthlyBudget,
      maxCallsPerHour: this.maxCallsPerHour,
      maxTokensPerRequest: this.maxTokensPerRequest,
      maxOutputTokens: this.maxOutputTokens,
      enabled: this.enabled,
      cacheTtlSeconds: this.cacheTtlSeconds,
    };
  }
}
