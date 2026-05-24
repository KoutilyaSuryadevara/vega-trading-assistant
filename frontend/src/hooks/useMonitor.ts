import { useEffect, useRef, useState } from 'react';
import type { TradingContext } from '../types';

interface UseMonitorOptions {
  context: TradingContext | null;
  conversationActive: boolean;
  isSpeaking: boolean;
  onAlert: (message: string) => void;
}

interface UseMonitorResult {
  lastAlert: string | null;
  alertCount: number;
}

type AlertKey =
  | 'trading_paused'
  | 'pnl_change'
  | 'new_orders'
  | 'alphabot_disconnected';

const COOLDOWN_MS = 60_000; // 60 seconds between same-condition alerts

export function useMonitor({
  context,
  conversationActive,
  isSpeaking,
  onAlert,
}: UseMonitorOptions): UseMonitorResult {
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  const [alertCount, setAlertCount] = useState(0);

  const prevContextRef = useRef<TradingContext | null>(null);
  const cooldownRef = useRef<Map<AlertKey, number>>(new Map());
  const alertingRef = useRef(false);
  const onAlertRef = useRef(onAlert);

  useEffect(() => { onAlertRef.current = onAlert; }, [onAlert]);

  const canAlert = (key: AlertKey): boolean => {
    const now = Date.now();
    const lastTime = cooldownRef.current.get(key) ?? 0;
    return now - lastTime > COOLDOWN_MS;
  };

  const recordAlert = (key: AlertKey) => {
    cooldownRef.current.set(key, Date.now());
  };

  const fireAlert = (message: string, key: AlertKey) => {
    if (alertingRef.current) return;
    if (!canAlert(key)) return;

    alertingRef.current = true;
    recordAlert(key);
    setLastAlert(message);
    setAlertCount(c => c + 1);
    onAlertRef.current(message);

    // Reset alerting flag after a generous window
    setTimeout(() => { alertingRef.current = false; }, 5_000);
  };

  useEffect(() => {
    if (!context) return;

    const prev = prevContextRef.current;
    prevContextRef.current = context;

    // Don't alert during active conversation or while already speaking
    if (conversationActive || isSpeaking) return;
    if (!prev) return; // skip first snapshot — no baseline yet

    const ts = context.tradingStatus;
    const pts = prev.tradingStatus;
    const as = context.alpacaStatus;
    const pas = prev.alpacaStatus;

    // 1. Trading paused
    if (!pts.isPaused && ts.isPaused) {
      fireAlert('Alert: Auto-trading has been paused.', 'trading_paused');
      return;
    }

    // 2. Significant P&L change (> $500)
    const pnlDelta = ts.totalPnl - pts.totalPnl;
    if (Math.abs(pnlDelta) > 500) {
      const sign = pnlDelta >= 0 ? 'up' : 'down';
      const formatted = `$${Math.abs(ts.totalPnl).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      const deltaFormatted = `$${Math.abs(pnlDelta).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
      fireAlert(
        `Portfolio P&L is now ${formatted}, ${sign} ${deltaFormatted}.`,
        'pnl_change'
      );
      return;
    }

    // 3. New open orders appeared
    const prevOrderIds = new Set(prev.openOrders.map(o => o.id));
    const newOrders = context.openOrders.filter(o => !prevOrderIds.has(o.id));
    if (newOrders.length > 0) {
      const o = newOrders[0];
      const side = o.side.toUpperCase();
      fireAlert(`New order detected: ${side} ${o.symbol}.`, 'new_orders');
      return;
    }

    // 4. AlphaBot (Alpaca) disconnected
    if (pas.connected && !as.connected) {
      fireAlert('Warning: AlphaBot connection has been lost.', 'alphabot_disconnected');
      return;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, conversationActive, isSpeaking]);

  return { lastAlert, alertCount };
}
