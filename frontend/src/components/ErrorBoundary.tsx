import { Component, ReactNode, ErrorInfo } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[VEGA ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d1117', color: '#e6edf3',
        fontFamily: 'monospace',
      }}>
        <div style={{
          maxWidth: 480, padding: 32, border: '1px solid #ff4444',
          borderRadius: 8, textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⬡</div>
          <h2 style={{ color: '#ff6b6b', marginBottom: 8 }}>VEGA encountered an error</h2>
          <p style={{ color: '#8b949e', marginBottom: 24, fontSize: 14 }}>
            {import.meta.env.PROD ? 'An unexpected error occurred. Please reload to continue.' : this.state.error?.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px', background: '#00d4aa', color: '#0d1117',
              border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'monospace', fontWeight: 700, fontSize: 14,
            }}
          >
            Reload VEGA
          </button>
        </div>
      </div>
    );
  }
}
