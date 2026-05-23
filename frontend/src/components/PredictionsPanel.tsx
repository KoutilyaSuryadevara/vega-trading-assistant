import type { Prediction } from '../types';

const signalColor = { buy: '#2ea043', sell: '#f85149', hold: '#f0883e' };
const signalBg = { buy: '#0d2818', sell: '#2d0b0b', hold: '#2d1d0b' };

interface Props {
  predictions: Prediction[];
  loading: boolean;
}

export function PredictionsPanel({ predictions, loading }: Props) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginBottom: 12 }}>
      <div style={{ color: '#8b949e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
        Top Predictions
      </div>
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} style={{ height: 28, background: '#21262d', borderRadius: 4, marginBottom: 8, animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))
      ) : predictions.length === 0 ? (
        <div style={{ color: '#8b949e', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
          No predictions available
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['Symbol', 'Signal', 'Conf', 'Price'].map(h => (
                <th key={h} style={{ color: '#8b949e', fontWeight: 400, textAlign: 'left', paddingBottom: 8, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {predictions.slice(0, 5).map((p) => (
              <tr key={p.symbol} style={{ borderTop: '1px solid #21262d' }}>
                <td style={{ padding: '6px 0', color: '#e6edf3', fontFamily: 'monospace', fontWeight: 700 }}>{p.symbol}</td>
                <td style={{ padding: '6px 8px 6px 0' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                    color: signalColor[p.signal],
                    background: signalBg[p.signal],
                    textTransform: 'uppercase',
                  }}>
                    {p.signal}
                  </span>
                </td>
                <td style={{ padding: '6px 8px 6px 0', color: '#e6edf3', fontFamily: 'monospace' }}>
                  {(p.confidence * 100).toFixed(0)}%
                </td>
                <td style={{ padding: '6px 0', color: '#e6edf3', fontFamily: 'monospace' }}>
                  ${p.price.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
