import type { TradingContext } from '../types';

const card: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
  padding: '16px', flex: 1, minWidth: 0,
};
const label: React.CSSProperties = {
  color: '#8b949e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
};
const value: React.CSSProperties = {
  color: '#e6edf3', fontFamily: 'monospace', fontSize: 14, fontWeight: 600,
};
const dot = (ok: boolean) => ({
  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
  background: ok ? '#2ea043' : '#f85149', marginRight: 6,
} as React.CSSProperties);

function Skeleton() {
  return (
    <div style={{
      height: 12, background: '#21262d', borderRadius: 4,
      animation: 'pulse 1.5s ease-in-out infinite', marginBottom: 6,
    }} />
  );
}

interface Props {
  context: TradingContext | null;
  loading: boolean;
}

export function StatusCards({ context, loading }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
      {/* Trading Status */}
      <div style={card}>
        <div style={{ ...label }}>Trading Status</div>
        {loading || !context ? (
          <><Skeleton /><Skeleton /></>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={dot(!context.tradingStatus.isPaused)} />
              <span style={value}>{context.tradingStatus.isPaused ? 'PAUSED' : 'ACTIVE'}</span>
            </div>
            <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
              Positions: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>{context.tradingStatus.activePositions}</span>
            </div>
            <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
              P&L: <span style={{
                color: context.tradingStatus.totalPnl >= 0 ? '#2ea043' : '#f85149',
                fontFamily: 'monospace',
              }}>${context.tradingStatus.totalPnl.toFixed(2)}</span>
            </div>
            <div style={{ color: '#8b949e', fontSize: 12 }}>
              Auto-trade: <span style={{ color: context.tradingStatus.isAutoTradingEnabled ? '#2ea043' : '#8b949e' }}>
                {context.tradingStatus.isAutoTradingEnabled ? 'ON' : 'OFF'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Alpaca Status */}
      <div style={card}>
        <div style={label}>Alpaca</div>
        {loading || !context ? (
          <><Skeleton /><Skeleton /></>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={dot(context.alpacaStatus.connected)} />
              <span style={value}>{context.alpacaStatus.connected ? context.alpacaStatus.accountStatus ?? 'CONNECTED' : 'OFFLINE'}</span>
            </div>
            {context.alpacaStatus.buyingPower !== undefined && (
              <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
                Buying power: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>
                  ${context.alpacaStatus.buyingPower.toLocaleString()}
                </span>
              </div>
            )}
            {context.alpacaStatus.portfolioValue !== undefined && (
              <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
                Portfolio: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>
                  ${context.alpacaStatus.portfolioValue.toLocaleString()}
                </span>
              </div>
            )}
            {context.alpacaStatus.dayTradeCount !== undefined && (
              <div style={{ color: '#8b949e', fontSize: 12 }}>
                DT count: <span style={{ color: context.alpacaStatus.dayTradeCount >= 3 ? '#f0883e' : '#e6edf3', fontFamily: 'monospace' }}>
                  {context.alpacaStatus.dayTradeCount}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Training Status */}
      <div style={card}>
        <div style={label}>ML Training</div>
        {loading || !context ? (
          <><Skeleton /><Skeleton /></>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              {context.trainingStatus.isRunning && (
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: '#00d4aa', marginRight: 6,
                  animation: 'pulse 1s ease-in-out infinite',
                }} />
              )}
              <span style={value}>{context.trainingStatus.isRunning ? 'RUNNING' : 'IDLE'}</span>
            </div>
            {context.trainingStatus.isRunning && context.trainingStatus.progress !== undefined && (
              <>
                <div style={{ marginBottom: 6 }}>
                  <div style={{
                    height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', background: '#00d4aa', borderRadius: 2,
                      width: `${context.trainingStatus.progress}%`,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
                <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 4 }}>
                  Epoch: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>
                    {context.trainingStatus.currentEpoch}/{context.trainingStatus.totalEpochs}
                  </span>
                </div>
              </>
            )}
            {!context.trainingStatus.isRunning && context.trainingStatus.accuracy !== undefined && (
              <div style={{ color: '#8b949e', fontSize: 12 }}>
                Accuracy: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>
                  {(context.trainingStatus.accuracy * 100).toFixed(1)}%
                </span>
              </div>
            )}
            {!context.trainingStatus.isRunning && context.trainingStatus.loss !== undefined && (
              <div style={{ color: '#8b949e', fontSize: 12 }}>
                Loss: <span style={{ color: '#e6edf3', fontFamily: 'monospace' }}>
                  {context.trainingStatus.loss.toFixed(4)}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
