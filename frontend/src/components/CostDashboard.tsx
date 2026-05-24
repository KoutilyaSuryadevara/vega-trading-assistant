import { useState, useEffect, useCallback } from 'react';

interface CostData {
  daily: {
    spend: number;
    budget: number;
    calls: number;
    cachedCalls: number;
    blockedCalls: number;
    avgTokens: number;
  };
  monthly: {
    spend: number;
    budget: number;
    calls: number;
  };
  cacheHitRate: number;
  topEndpoints: Array<{ endpoint: string; calls: number; spend: number }>;
  status: string;
  enabled: boolean;
}

interface Props {
  apiUrl: string;
}

function spendColor(pct: number): string {
  if (pct >= 85) return '#f85149';
  if (pct >= 60) return '#f0883e';
  return '#2ea043';
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden', marginTop: 2 }}>
      <div style={{
        width: `${pct}%`,
        height: '100%',
        background: color,
        borderRadius: 2,
        transition: 'width 0.4s ease',
      }} />
    </div>
  );
}

export function CostDashboard({ apiUrl }: Props) {
  const [data, setData] = useState<CostData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchCost = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/ai/cost`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as CostData;
      setData(json);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [apiUrl]);

  useEffect(() => {
    void fetchCost();
    const id = setInterval(() => { void fetchCost(); }, 60_000);
    return () => clearInterval(id);
  }, [fetchCost]);

  if (error) {
    return (
      <div style={{
        border: '1px solid #30363d', borderRadius: 8, padding: '10px 12px',
        background: '#161b22', fontSize: 11, color: '#484f58', fontFamily: 'monospace',
      }}>
        AI cost data unavailable
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{
        border: '1px solid #30363d', borderRadius: 8, padding: '10px 12px',
        background: '#161b22', fontSize: 11, color: '#484f58', fontFamily: 'monospace',
      }}>
        Loading AI cost...
      </div>
    );
  }

  const dailyPct = (data.daily.spend / data.daily.budget) * 100;
  const monthlyPct = (data.monthly.spend / data.monthly.budget) * 100;
  const dailyColor = spendColor(dailyPct);
  const monthlyColor = spendColor(monthlyPct);

  // Status icon
  const statusIcon = data.status.startsWith('✓') ? '✓' : data.status.startsWith('⚠') ? '⚠' : '✗';
  const statusIconColor = statusIcon === '✓' ? '#2ea043' : statusIcon === '⚠' ? '#f0883e' : '#f85149';
  const statusText = data.status.replace(/^[✓⚠✗]\s*/, '');

  return (
    <div style={{
      border: '1px solid #21262d',
      borderRadius: 8,
      background: '#161b22',
      padding: '10px 12px',
      fontFamily: 'monospace',
      fontSize: 11,
      maxHeight: 200,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <span style={{ color: '#8b949e', fontWeight: 700, letterSpacing: 1, fontSize: 10 }}>
          AI COST MONITOR
        </span>
        <span style={{ color: data.enabled ? '#2ea043' : '#f85149', fontSize: 10 }}>
          {data.enabled ? 'ENABLED' : 'DISABLED'}
        </span>
      </div>

      {/* TODAY + THIS MONTH */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 6 }}>
        {/* Daily */}
        <div>
          <div style={{ color: '#484f58', fontSize: 10, marginBottom: 1 }}>TODAY</div>
          <div style={{ color: dailyColor, fontWeight: 700, fontSize: 13 }}>
            ${data.daily.spend.toFixed(2)}
            <span style={{ color: '#484f58', fontWeight: 400, fontSize: 10 }}>/${data.daily.budget.toFixed(2)}</span>
          </div>
          <ProgressBar value={data.daily.spend} max={data.daily.budget} color={dailyColor} />
          <div style={{ color: '#484f58', fontSize: 10, marginTop: 2 }}>
            {data.daily.calls} calls
          </div>
        </div>

        {/* Monthly */}
        <div>
          <div style={{ color: '#484f58', fontSize: 10, marginBottom: 1 }}>THIS MONTH</div>
          <div style={{ color: monthlyColor, fontWeight: 700, fontSize: 13 }}>
            ${data.monthly.spend.toFixed(2)}
            <span style={{ color: '#484f58', fontWeight: 400, fontSize: 10 }}>/${data.monthly.budget.toFixed(2)}</span>
          </div>
          <ProgressBar value={data.monthly.spend} max={data.monthly.budget} color={monthlyColor} />
          <div style={{ color: '#484f58', fontSize: 10, marginTop: 2 }}>
            {data.monthly.calls} calls
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', gap: 8, color: '#8b949e', fontSize: 10,
        borderTop: '1px solid #21262d', paddingTop: 6, marginBottom: 6,
        flexWrap: 'wrap',
      }}>
        <span>Cache: <span style={{ color: '#58a6ff' }}>{data.cacheHitRate}%</span></span>
        <span>Blocked: <span style={{ color: data.daily.blockedCalls > 0 ? '#f85149' : '#484f58' }}>{data.daily.blockedCalls}</span></span>
        <span>Avg: <span style={{ color: '#8b949e' }}>{data.daily.avgTokens.toLocaleString()} tok</span></span>
        <span>Cached: <span style={{ color: '#2ea043' }}>{data.daily.cachedCalls}</span></span>
      </div>

      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        <span style={{ color: statusIconColor, flexShrink: 0 }}>{statusIcon}</span>
        <span style={{ color: '#8b949e', fontSize: 10, lineHeight: 1.4 }}>{statusText}</span>
      </div>
    </div>
  );
}
