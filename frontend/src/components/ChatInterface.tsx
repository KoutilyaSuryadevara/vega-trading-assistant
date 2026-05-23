import { useRef, useEffect } from 'react';
import { VoiceInput } from './VoiceInput';
import type { ChatMessage, TradingCommand } from '../types';

interface Props {
  messages: ChatMessage[];
  onSend: (msg: string) => void;
  loading: boolean;
  error: string | null;
  suggestions: string[];
  voiceEnabled: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  pendingAction: TradingCommand | null;
}

function formatTime(ts: string) {
  try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row',
      gap: 10, marginBottom: 16, alignItems: 'flex-end',
    }}>
      {!isUser && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: '#00d4aa',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#0d1117',
        }}>V</div>
      )}
      <div style={{ maxWidth: '75%' }}>
        <div style={{
          padding: '10px 14px',
          background: isUser ? '#1f6feb' : '#1c2128',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          color: '#e6edf3', fontSize: 14, lineHeight: 1.6,
          border: isUser ? 'none' : '1px solid #30363d',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.content}
        </div>
        <div style={{ color: '#8b949e', fontSize: 11, marginTop: 4, textAlign: isUser ? 'right' : 'left' }}>
          {formatTime(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

export function ChatInterface({ messages, onSend, loading, error, suggestions, voiceEnabled, inputValue, onInputChange, pendingAction }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && !loading) onSend(inputValue.trim());
    }
  }

  function handleSend() {
    if (inputValue.trim() && !loading) onSend(inputValue.trim());
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0d1117', borderRadius: 8, border: '1px solid #30363d', overflow: 'hidden',
    }}>
      {/* Error banner */}
      {error && (
        <div style={{
          padding: '10px 16px', background: '#2d0b0b', borderBottom: '1px solid #f85149',
          color: '#f85149', fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 20, scrollbarWidth: 'thin', scrollbarColor: '#21262d #0d1117' }}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 60 }}>
            <div style={{ fontSize: 40, marginBottom: 16, color: '#00d4aa' }}>⬡</div>
            <div style={{ color: '#8b949e', fontSize: 15, marginBottom: 8 }}>
              Ask VEGA anything about your trading portfolio
            </div>
            <div style={{ color: '#484f58', fontSize: 13 }}>
              "What are today's strongest buy signals?" · "Why was AAPL flagged?" · "Is auto-trading active?"
            </div>
          </div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} />)
        )}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%', background: '#00d4aa',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: '#0d1117', flexShrink: 0,
            }}>V</div>
            <div style={{
              padding: '12px 16px', background: '#1c2128', borderRadius: '18px 18px 18px 4px',
              border: '1px solid #30363d', display: 'flex', gap: 5, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#00d4aa',
                  animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* Pending action indicator */}
        {pendingAction && !loading && (
          <div style={{
            margin: '8px 0 16px', padding: '10px 14px',
            background: '#2d1d0b', border: '1px solid #f0883e', borderRadius: 8,
            color: '#f0883e', fontSize: 13,
          }}>
            ⚡ Action pending approval: {pendingAction.description}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && !loading && (
        <div style={{
          padding: '8px 16px', display: 'flex', gap: 8, flexWrap: 'wrap',
          borderTop: '1px solid #21262d',
        }}>
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => onSend(s)} style={{
              padding: '4px 12px', background: '#161b22', border: '1px solid #30363d',
              borderRadius: 20, color: '#8b949e', fontSize: 12, cursor: 'pointer',
              fontFamily: 'inherit',
            }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #21262d',
        display: 'flex', gap: 10, alignItems: 'flex-end',
      }}>
        <VoiceInput onTranscript={(t) => { onInputChange(t); inputRef.current?.focus(); }} enabled={voiceEnabled} />
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask VEGA... (Enter to send, Shift+Enter for newline)"
          disabled={loading}
          rows={1}
          style={{
            flex: 1, background: '#161b22', border: '1px solid #30363d',
            borderRadius: 8, color: '#e6edf3', fontSize: 14, padding: '10px 14px',
            resize: 'none', fontFamily: 'inherit', outline: 'none',
            lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
          }}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = Math.min(t.scrollHeight, 120) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !inputValue.trim()}
          style={{
            width: 40, height: 40, borderRadius: 8, border: 'none',
            background: loading || !inputValue.trim() ? '#21262d' : '#00d4aa',
            color: loading || !inputValue.trim() ? '#484f58' : '#0d1117',
            cursor: loading || !inputValue.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.2s',
          }}
          title="Send message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
