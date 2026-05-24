import { useRef, useEffect, useState } from 'react';
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

// ─── Structured response parser ───────────────────────────────────────────────

interface Section { icon: string; label: string; content: string; color: string; }

const SECTION_PATTERNS: Array<{ regex: RegExp; icon: string; label: string; color: string }> = [
  { regex: /\*\*[🎯]?\s*UNDERSTANDING\s*\*\*[:\s]*/i, icon: '🎯', label: 'UNDERSTANDING', color: '#58a6ff' },
  { regex: /\*\*[📋]?\s*PLAN\s*\*\*[:\s]*/i,          icon: '📋', label: 'PLAN',          color: '#00d4aa' },
  { regex: /\*\*[⚡]?\s*EXECUTING\s*\*\*[:\s]*/i,      icon: '⚡', label: 'EXECUTING',    color: '#f0883e' },
  { regex: /\*\*[🔍]?\s*FINDINGS\s*\*\*[:\s]*/i,      icon: '🔍', label: 'FINDINGS',     color: '#a371f7' },
  { regex: /\*\*[📊]?\s*STATUS\s*\*\*[:\s]*/i,        icon: '📊', label: 'STATUS',       color: '#2ea043' },
  { regex: /\*\*[⚠]?\s*RISKS?\s*\*\*[:\s]*/i,         icon: '⚠',  label: 'RISKS',        color: '#f85149' },
  { regex: /\*\*[🚀]?\s*NEXT\s*\*\*[:\s]*/i,          icon: '🚀', label: 'NEXT',         color: '#ffa657' },
];

function parseStructuredResponse(text: string): Section[] | null {
  // Check if this looks like a structured response
  const hasStructure = SECTION_PATTERNS.some(p => p.regex.test(text));
  if (!hasStructure) return null;

  const sections: Section[] = [];
  let remaining = text;

  // Find all section positions
  const positions: Array<{ index: number; pattern: typeof SECTION_PATTERNS[0] }> = [];
  for (const pattern of SECTION_PATTERNS) {
    const match = remaining.match(pattern.regex);
    if (match && match.index !== undefined) {
      positions.push({ index: match.index, pattern });
    }
  }
  positions.sort((a, b) => a.index - b.index);

  // Extract content between sections
  for (let i = 0; i < positions.length; i++) {
    const { pattern } = positions[i];
    const startIdx = positions[i].index;
    const endIdx = i + 1 < positions.length ? positions[i + 1].index : remaining.length;

    const headerMatch = remaining.substring(startIdx).match(pattern.regex);
    if (!headerMatch) continue;

    const contentStart = startIdx + (headerMatch.index ?? 0) + headerMatch[0].length;
    const rawContent = remaining.substring(contentStart, endIdx).trim();

    if (rawContent) {
      sections.push({ icon: pattern.icon, label: pattern.label, content: rawContent, color: pattern.color });
    }
  }

  return sections.length >= 2 ? sections : null;
}

// ─── Markdown-ish inline renderer ────────────────────────────────────────────

function renderInline(text: string): React.ReactNode {
  // Handle bold **text**, inline code `code`, and list items
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ color: '#e6edf3' }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 3,
          padding: '1px 5px', fontFamily: 'monospace', fontSize: 12, color: '#79c0ff',
        }}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderContent(content: string): React.ReactNode {
  const lines = content.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        nodes.push(
          <pre key={`code-${codeKey++}`} style={{
            background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
            padding: '10px 14px', margin: '6px 0', fontFamily: 'monospace',
            fontSize: 12, overflowX: 'auto', color: '#79c0ff',
          }}>
            {codeLines.join('\n')}
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.match(/^(\d+\.\s|[-*]\s)/)) {
      const isNumbered = line.match(/^\d+\.\s/);
      const content = line.replace(/^(\d+\.\s|[-*]\s)/, '');
      nodes.push(
        <div key={i} style={{ display: 'flex', gap: 8, margin: '3px 0', alignItems: 'flex-start' }}>
          <span style={{ color: '#00d4aa', flexShrink: 0, fontSize: 12, fontFamily: 'monospace', minWidth: 18 }}>
            {isNumbered ? line.match(/^\d+/)![0] + '.' : '▸'}
          </span>
          <span style={{ lineHeight: 1.5 }}>{renderInline(content)}</span>
        </div>
      );
      continue;
    }

    if (line.trim() === '') {
      if (i > 0 && lines[i - 1].trim() !== '') {
        nodes.push(<div key={i} style={{ height: 4 }} />);
      }
      continue;
    }

    nodes.push(
      <div key={i} style={{ margin: '2px 0', lineHeight: 1.6 }}>
        {renderInline(line)}
      </div>
    );
  }

  return nodes;
}

// ─── Structured Response Card ────────────────────────────────────────────────

function StructuredResponseCard({ sections }: { sections: Section[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (label: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.label);
        return (
          <div key={section.label} style={{
            border: `1px solid ${section.color}33`,
            borderLeft: `3px solid ${section.color}`,
            borderRadius: '0 6px 6px 0',
            background: `${section.color}08`,
            overflow: 'hidden',
          }}>
            <button
              onClick={() => toggle(section.label)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 12px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 14 }}>{section.icon}</span>
              <span style={{
                fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                color: section.color, letterSpacing: 1, flex: 1,
              }}>
                {section.label}
              </span>
              <span style={{ color: section.color, fontSize: 10, opacity: 0.7 }}>
                {isCollapsed ? '▸' : '▾'}
              </span>
            </button>

            {!isCollapsed && (
              <div style={{
                padding: '0 12px 10px 34px', color: '#c9d1d9', fontSize: 13,
              }}>
                {renderContent(section.content)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Plain message bubble ─────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const sections = !isUser ? parseStructuredResponse(msg.content) : null;

  if (!isUser && sections) {
    return (
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-start' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: '#00d4aa',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#0d1117', marginTop: 2,
        }}>V</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StructuredResponseCard sections={sections} />
          <div style={{ color: '#8b949e', fontSize: 11, marginTop: 4 }}>
            {formatTime(msg.timestamp)}
          </div>
        </div>
      </div>
    );
  }

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
      <div style={{ maxWidth: '78%' }}>
        <div style={{
          padding: '10px 14px',
          background: isUser ? '#1f6feb' : '#1c2128',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          color: '#e6edf3', fontSize: 14, lineHeight: 1.6,
          border: isUser ? 'none' : '1px solid #30363d',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {!isUser ? renderContent(msg.content) : msg.content}
        </div>
        <div style={{ color: '#8b949e', fontSize: 11, marginTop: 4, textAlign: isUser ? 'right' : 'left' }}>
          {formatTime(msg.timestamp)}
        </div>
      </div>
    </div>
  );
}

// ─── Agentic loading indicator ────────────────────────────────────────────────

const WORKING_LABELS = [
  'Analyzing system state…',
  'Inspecting logs…',
  'Running diagnostics…',
  'Executing workflow…',
  'Coordinating agents…',
  'Synthesizing findings…',
];

function AgenticLoader() {
  const [labelIdx, setLabelIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setLabelIdx(i => (i + 1) % WORKING_LABELS.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', background: '#00d4aa',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#0d1117', flexShrink: 0,
      }}>V</div>
      <div style={{
        padding: '10px 16px', background: '#1c2128', borderRadius: '18px 18px 18px 4px',
        border: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              width: 5, height: 5, borderRadius: '50%', background: '#00d4aa',
              animation: `bounce 1.2s ${i * 0.2}s ease-in-out infinite`,
            }} />
          ))}
        </div>
        <span style={{ color: '#8b949e', fontSize: 12, fontFamily: 'monospace' }}>
          {WORKING_LABELS[labelIdx]}
        </span>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

const EXAMPLE_COMMANDS = [
  { label: 'Inspect trading', cmd: 'Inspect the current trading status and identify any issues' },
  { label: 'Analyze P&L', cmd: 'Analyze today\'s P&L and explain the drivers' },
  { label: 'Check ML health', cmd: 'Check the ML model health and prediction accuracy' },
  { label: 'System diagnostics', cmd: 'Run a full system diagnostic and report any anomalies' },
  { label: 'Watchlist review', cmd: 'Review the current watchlist and suggest improvements' },
  { label: 'Open incidents', cmd: 'Show me all open incidents and active tasks' },
];

// ─── Main ChatInterface ───────────────────────────────────────────────────────

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
          color: '#f85149', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <span>✗</span>
          <span>{error}</span>
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 20,
        scrollbarWidth: 'thin', scrollbarColor: '#21262d #0d1117',
      }}>
        {messages.length === 0 ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 36, marginBottom: 10, color: '#00d4aa' }}>⬡</div>
              <div style={{ color: '#e6edf3', fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
                VEGA — Autonomous Engineering Intelligence
              </div>
              <div style={{ color: '#8b949e', fontSize: 13, lineHeight: 1.7, maxWidth: 420, margin: '0 auto' }}>
                I inspect systems, analyze logs, coordinate agents, execute workflows, and proactively
                manage your trading infrastructure. Tell me what to do — I'll figure out the rest.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {EXAMPLE_COMMANDS.map(({ label, cmd }) => (
                <button key={label} onClick={() => onSend(cmd)} style={{
                  padding: '10px 14px', background: '#161b22', border: '1px solid #30363d',
                  borderRadius: 8, color: '#8b949e', fontSize: 12, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left', transition: 'border-color 0.2s',
                  lineHeight: 1.4,
                }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#00d4aa')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#30363d')}
                >
                  <div style={{ color: '#00d4aa', fontWeight: 600, marginBottom: 2, fontSize: 11 }}>
                    {label}
                  </div>
                  <div style={{ color: '#484f58', fontSize: 11 }}>{cmd.slice(0, 60)}…</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} />)
        )}

        {loading && <AgenticLoader />}

        {pendingAction && !loading && (
          <div style={{
            margin: '8px 0 16px', padding: '10px 14px',
            background: '#2d1d0b', border: '1px solid #f0883e', borderRadius: 8,
            color: '#f0883e', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span>⚡</span>
            <span>Pending approval: <strong>{pendingAction.description}</strong></span>
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
              fontFamily: 'inherit', transition: 'color 0.2s, border-color 0.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.color = '#00d4aa'; e.currentTarget.style.borderColor = '#00d4aa'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#8b949e'; e.currentTarget.style.borderColor = '#30363d'; }}
            >
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
        <VoiceInput
          onTranscript={(t) => { onInputChange(t); inputRef.current?.focus(); }}
          enabled={voiceEnabled}
        />
        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={e => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Ask VEGA anything — "Fix the options trading issue" · "Check system health" · "Deploy it"'
          disabled={loading}
          rows={1}
          style={{
            flex: 1, background: '#161b22', border: '1px solid #30363d',
            borderRadius: 8, color: '#e6edf3', fontSize: 14, padding: '10px 14px',
            resize: 'none', fontFamily: 'inherit', outline: 'none',
            lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
            transition: 'border-color 0.2s',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#00d4aa44')}
          onBlur={e => (e.currentTarget.style.borderColor = '#30363d')}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = Math.min(t.scrollHeight, 120) + 'px';
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !inputValue.trim()}
          title="Send message"
          style={{
            width: 40, height: 40, borderRadius: 8, border: 'none',
            background: loading || !inputValue.trim() ? '#21262d' : '#00d4aa',
            color: loading || !inputValue.trim() ? '#484f58' : '#0d1117',
            cursor: loading || !inputValue.trim() ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.2s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
