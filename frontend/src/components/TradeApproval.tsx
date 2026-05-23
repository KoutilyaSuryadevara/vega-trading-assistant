import type { TradingCommand } from '../types';

const riskColors: Record<TradingCommand['riskLevel'], { fg: string; bg: string }> = {
  low: { fg: '#2ea043', bg: '#0d2818' },
  medium: { fg: '#f0883e', bg: '#2d1d0b' },
  high: { fg: '#f85149', bg: '#2d0b0b' },
  critical: { fg: '#ffffff', bg: '#8b0000' },
};

interface Props {
  action: TradingCommand | null;
  onApprove: () => void;
  onReject: () => void;
}

export function TradeApproval({ action, onApprove, onReject }: Props) {
  if (!action) return null;

  const colors = riskColors[action.riskLevel];

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
        padding: 32, maxWidth: 440, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#8b949e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Action Required
          </div>
          <h3 style={{ color: '#e6edf3', margin: '0 0 8px', fontFamily: 'monospace', fontSize: 18 }}>
            {action.description}
          </h3>
          {action.params && (
            <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 12, fontFamily: 'monospace' }}>
              {Object.entries(action.params).map(([k, v]) => `${k}: ${v}`).join(' · ')}
            </div>
          )}
          <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: 4,
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
            color: colors.fg, background: colors.bg,
          }}>
            {action.riskLevel} risk
          </span>
        </div>

        {action.riskLevel === 'critical' || action.riskLevel === 'high' ? (
          <div style={{
            background: '#2d0b0b', border: '1px solid #f85149', borderRadius: 6,
            padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#f85149',
          }}>
            ⚠ This action will affect live trading. Cannot be undone.
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onReject}
            style={{
              flex: 1, padding: '12px', background: '#21262d', color: '#8b949e',
              border: '1px solid #30363d', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 14, fontWeight: 600,
            }}
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            style={{
              flex: 1, padding: '12px',
              background: action.riskLevel === 'critical' ? '#8b0000' : '#c82b2b',
              color: '#ffffff', border: 'none', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
