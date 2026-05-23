import type { CommandHistoryItem } from '../types';

function formatCommand(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

interface Props {
  commands: CommandHistoryItem[];
}

export function CommandHistory({ commands }: Props) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16 }}>
      <div style={{ color: '#8b949e', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
        Recent Commands
      </div>
      {commands.length === 0 ? (
        <div style={{ color: '#8b949e', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
          No commands executed yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {commands.slice(0, 10).map((cmd, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 10px', background: '#0d1117', borderRadius: 6,
              border: '1px solid #21262d',
            }}>
              <div>
                <div style={{ color: '#e6edf3', fontSize: 13, fontFamily: 'monospace' }}>
                  {formatCommand(cmd.type)}
                </div>
                <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>
                  {formatTime(cmd.timestamp)} · {cmd.mode}
                </div>
              </div>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                color: cmd.success ? '#2ea043' : '#f85149',
                background: cmd.success ? '#0d2818' : '#2d0b0b',
              }}>
                {cmd.success ? 'OK' : 'FAIL'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
