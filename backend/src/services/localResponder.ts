// LocalResponder — handles queries WITHOUT calling Claude
// Used when: budget exceeded, cache hit, simple/known query

import type { TradingContext } from '../types';

export class LocalResponder {
  // Simple keywords that indicate a status-lookup query
  private static readonly STATUS_KEYWORDS = [
    'status', 'trading', 'paused', 'active', 'running', 'stopped',
    'health', 'help', 'watchlist', 'predictions', 'orders',
  ];

  private static readonly COMPLEX_PATTERNS = [
    /\bfix\b/i, /\bdebug\b/i, /\bwhy\b/i, /\banalyze\b/i, /\banalyse\b/i,
    /\bimprove\b/i, /\bdeploy\b/i, /\bissue\b/i, /\berror\b/i, /\bproblem\b/i,
    /\bbroken\b/i, /\bcreate\b/i, /\bimplement\b/i, /\bcode\b/i, /\bwrite\b/i,
  ];

  classify(message: string): 'simple' | 'complex' {
    const trimmed = message.trim().toLowerCase();

    // More than 15 words → complex
    if (trimmed.split(/\s+/).length > 15) return 'complex';

    // Contains complex-signal words → complex
    for (const pattern of LocalResponder.COMPLEX_PATTERNS) {
      if (pattern.test(trimmed)) return 'complex';
    }

    // Single-word command
    if (/^(status|health|help|watchlist|predictions|orders)$/.test(trimmed)) return 'simple';

    // "what is" + status keyword
    if (/^what is/.test(trimmed)) {
      for (const kw of LocalResponder.STATUS_KEYWORDS) {
        if (trimmed.includes(kw)) return 'simple';
      }
    }

    // "show me" + data keyword
    if (/^show me/.test(trimmed)) {
      if (/\b(status|watchlist|predictions|orders|health)\b/.test(trimmed)) return 'simple';
    }

    // "is trading" + state
    if (/^is trading\s+(active|paused|running|stopped|enabled|disabled)/.test(trimmed)) {
      return 'simple';
    }

    return 'complex';
  }

  getSimpleResponse(message: string, context: TradingContext | null): string {
    const trimmed = message.trim().toLowerCase();

    // Help
    if (/^help$/.test(trimmed)) {
      return [
        'VEGA (Voice-Enabled Guidance Agent) — AlphaBot AI Assistant.',
        '',
        'Quick commands:',
        '  status         — trading system overview',
        '  watchlist      — symbols being tracked',
        '  predictions    — top ML signals',
        '  health         — system health summary',
        '',
        'For complex analysis, investigations, or commands, just ask naturally.',
        'Type "status" to see the current trading snapshot.',
      ].join('\n');
    }

    // Health
    if (/^health$/.test(trimmed) || /health status/.test(trimmed)) {
      if (!context) return 'Trading context not available. The backend may be starting up.';
      const alpaca = context.alpacaStatus.connected ? 'CONNECTED' : 'DISCONNECTED';
      const trading = context.tradingStatus.isAutoTradingEnabled
        ? (context.tradingStatus.isPaused ? 'AUTO — PAUSED' : 'AUTO — ACTIVE')
        : 'MANUAL';
      const ml = context.trainingStatus.isRunning ? 'TRAINING' : 'IDLE';
      return `Health snapshot:\n  Alpaca: ${alpaca}\n  Trading: ${trading}\n  ML: ${ml}\n  Positions: ${context.tradingStatus.activePositions}`;
    }

    // Status
    if (/^status$/.test(trimmed) || /what is (the )?status/.test(trimmed) || /show me (the )?status/.test(trimmed)) {
      if (!context) return 'Trading context not available yet. Please try again in a moment.';
      const ts = context.tradingStatus;
      const lines: string[] = [
        'Trading System Status:',
        `  Auto-trading: ${ts.isAutoTradingEnabled ? 'ENABLED' : 'DISABLED'}${ts.isPaused ? ' (PAUSED)' : ''}`,
        `  Active positions: ${ts.activePositions}`,
        `  Total P&L: $${ts.totalPnl.toFixed(2)}`,
        `  Alpaca: ${context.alpacaStatus.connected ? `CONNECTED ($${(context.alpacaStatus.buyingPower ?? 0).toFixed(0)} buying power)` : 'DISCONNECTED'}`,
        `  ML training: ${context.trainingStatus.isRunning ? `RUNNING (${(context.trainingStatus.progress ?? 0).toFixed(0)}%)` : 'IDLE'}`,
      ];
      return lines.join('\n');
    }

    // Is trading active/paused?
    if (/is trading\s+(active|paused|running|stopped|enabled|disabled)/.test(trimmed) ||
        /is (auto[- ]?)?trading/.test(trimmed)) {
      if (!context) return 'Unable to determine trading status — context unavailable.';
      const ts = context.tradingStatus;
      if (!ts.isAutoTradingEnabled) return 'Auto-trading is DISABLED.';
      if (ts.isPaused) return 'Auto-trading is ENABLED but currently PAUSED.';
      return 'Auto-trading is ACTIVE and running.';
    }

    // Watchlist
    if (/^watchlist$/.test(trimmed) || /show me (the )?watchlist/.test(trimmed) || /what is (the )?watchlist/.test(trimmed)) {
      if (!context) return 'Watchlist not available — context loading.';
      const wl = context.watchlist;
      if (wl.length === 0) return 'Watchlist is empty.';
      return `Watchlist (${wl.length} symbols): ${wl.join(', ')}`;
    }

    // Predictions
    if (/^predictions$/.test(trimmed) || /show me (the )?predictions/.test(trimmed) || /what are (the )?predictions/.test(trimmed)) {
      if (!context) return 'Predictions not available — context loading.';
      const preds = context.predictions.slice(0, 5);
      if (preds.length === 0) return 'No predictions available.';
      const lines = preds.map(p =>
        `  ${p.symbol}: ${p.signal.toUpperCase()} (${(p.confidence * 100).toFixed(0)}% conf, $${p.price})`
      );
      return `Top ML predictions:\n${lines.join('\n')}`;
    }

    // Orders
    if (/^orders$/.test(trimmed) || /show me (the )?orders/.test(trimmed)) {
      if (!context) return 'Order data not available — context loading.';
      return `Active positions: ${context.tradingStatus.activePositions}. Use the trading dashboard for full order details.`;
    }

    // Cannot handle → caller should fall through to Claude
    return '';
  }

  getBudgetExceededResponse(statusMessage: string): string {
    return [
      `Advanced AI reasoning is paused — ${statusMessage}`,
      '',
      'Trading is operating normally on its autonomous rules.',
      '',
      'For complex analysis, please wait until tomorrow or increase the daily budget',
      'by setting the CLAUDE_DAILY_BUDGET_USD environment variable.',
      '',
      'Quick commands still available: status, watchlist, predictions, health, help.',
    ].join('\n');
  }
}
