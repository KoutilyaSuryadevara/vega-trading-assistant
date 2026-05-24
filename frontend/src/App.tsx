import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ChatInterface } from './components/ChatInterface';
import { StatusCards } from './components/StatusCards';
import { PredictionsPanel } from './components/PredictionsPanel';
import { CommandHistory } from './components/CommandHistory';
import { TradeApproval } from './components/TradeApproval';
import { VegaOrb } from './components/VegaOrb';
import { api } from './services/api';
import { useJarvisVoice } from './hooks/useJarvisVoice';
import { useWakeWord } from './hooks/useWakeWord';
import { useConversation } from './hooks/useConversation';
import { useMonitor } from './hooks/useMonitor';
import type {
  ChatMessage, TradingContext, TradingCommand, AssistantMode,
  HealthResponse, CommandHistoryItem,
} from './types';
import type { OrbMode } from './components/VegaOrb';

// ─── State ───────────────────────────────────────────────────────────────────

interface AppState {
  messages: ChatMessage[];
  context: TradingContext | null;
  health: HealthResponse | null;
  mode: AssistantMode;
  sessionId: string;
  chatLoading: boolean;
  contextLoading: boolean;
  chatError: string | null;
  suggestions: string[];
  pendingAction: TradingCommand | null;
  commandHistory: CommandHistoryItem[];
  inputValue: string;
}

type Action =
  | { type: 'SET_MODE'; mode: AssistantMode }
  | { type: 'ADD_USER_MESSAGE'; message: string }
  | { type: 'ADD_ASSISTANT_MESSAGE'; message: ChatMessage; suggestions: string[]; pendingAction?: TradingCommand }
  | { type: 'SET_CHAT_LOADING'; loading: boolean }
  | { type: 'SET_CHAT_ERROR'; error: string | null }
  | { type: 'SET_CONTEXT'; context: TradingContext }
  | { type: 'SET_CONTEXT_LOADING'; loading: boolean }
  | { type: 'SET_HEALTH'; health: HealthResponse }
  | { type: 'CLEAR_PENDING_ACTION' }
  | { type: 'ADD_COMMAND_HISTORY'; item: CommandHistoryItem }
  | { type: 'SET_INPUT'; value: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_MODE': return { ...state, mode: action.mode };
    case 'ADD_USER_MESSAGE': {
      const msg: ChatMessage = { id: uuidv4(), role: 'user', content: action.message, timestamp: new Date().toISOString() };
      return { ...state, messages: [...state.messages, msg], chatLoading: true, chatError: null, suggestions: [], inputValue: '' };
    }
    case 'ADD_ASSISTANT_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.message],
        chatLoading: false,
        suggestions: action.suggestions ?? [],
        pendingAction: action.pendingAction ?? null,
      };
    case 'SET_CHAT_LOADING': return { ...state, chatLoading: action.loading };
    case 'SET_CHAT_ERROR': return { ...state, chatLoading: false, chatError: action.error };
    case 'SET_CONTEXT': return { ...state, context: action.context, contextLoading: false };
    case 'SET_CONTEXT_LOADING': return { ...state, contextLoading: action.loading };
    case 'SET_HEALTH': return { ...state, health: action.health };
    case 'CLEAR_PENDING_ACTION': return { ...state, pendingAction: null };
    case 'ADD_COMMAND_HISTORY':
      return { ...state, commandHistory: [action.item, ...state.commandHistory].slice(0, 20) };
    case 'SET_INPUT': return { ...state, inputValue: action.value };
    default: return state;
  }
}

const initialState: AppState = {
  messages: [],
  context: null,
  health: null,
  mode: 'readonly',
  sessionId: uuidv4(),
  chatLoading: false,
  contextLoading: true,
  chatError: null,
  suggestions: [],
  pendingAction: null,
  commandHistory: [],
  inputValue: '',
};

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [muted, setMuted] = useState(false);
  const contextIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const introFiredRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // ── Voice: TTS ──────────────────────────────────────────────────────────────
  const { speak: rawSpeak, stopSpeaking, isSpeaking, voiceName } = useJarvisVoice();

  // Wrap speak to honour mute toggle
  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (mutedRef.current) {
      onEnd?.();
      return;
    }
    rawSpeak(text, onEnd);
  }, [rawSpeak]);

  // ── Core send logic ─────────────────────────────────────────────────────────
  const conversationSetModeRef = useRef<((m: import('./hooks/useConversation').ConversationMode) => void) | null>(null);

  const sendMessage = useCallback(async (message: string, fromVoice = false) => {
    dispatch({ type: 'ADD_USER_MESSAGE', message });
    if (fromVoice && conversationSetModeRef.current) {
      conversationSetModeRef.current('processing');
    }
    try {
      const response = await api.chat({ message, sessionId: stateRef.current.sessionId, mode: stateRef.current.mode });
      const assistantMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant', content: response.message, timestamp: response.timestamp,
      };
      dispatch({
        type: 'ADD_ASSISTANT_MESSAGE',
        message: assistantMsg,
        suggestions: response.suggestions ?? [],
        pendingAction: response.pendingAction,
      });

      // Speak the response
      if (fromVoice && conversationSetModeRef.current) {
        conversationSetModeRef.current('speaking');
      }
      speak(response.message, () => {
        if (conversationSetModeRef.current) {
          conversationSetModeRef.current('idle');
        }
      });
    } catch (err) {
      dispatch({ type: 'SET_CHAT_ERROR', error: (err as Error).message });
      if (conversationSetModeRef.current) conversationSetModeRef.current('idle');
    }
  }, [speak]);

  // ── Conversation loop ───────────────────────────────────────────────────────
  const { conversationMode, activate, deactivate, setMode: setConvMode } = useConversation({
    speak,
    stopSpeaking,
    onQuery: (transcript) => {
      sendMessage(transcript, true);
    },
  });
  conversationSetModeRef.current = setConvMode;

  // ── Wake word ───────────────────────────────────────────────────────────────
  const { isListeningForWake, isSupported: wakeSupported } = useWakeWord({
    onWake: (rest) => activate(rest),
    isSpeaking,
  });

  // ── Monitor ─────────────────────────────────────────────────────────────────
  const conversationActive = conversationMode !== 'idle';
  useMonitor({
    context: state.context,
    conversationActive,
    isSpeaking,
    onAlert: (message) => {
      speak(message);
    },
  });

  // ── Data fetching ───────────────────────────────────────────────────────────
  const fetchContext = useCallback(async () => {
    try {
      const context = await api.getContext();
      dispatch({ type: 'SET_CONTEXT', context });
    } catch {
      dispatch({ type: 'SET_CONTEXT_LOADING', loading: false });
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const health = await api.getHealth();
      dispatch({ type: 'SET_HEALTH', health });
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchContext();
    fetchHealth();
    contextIntervalRef.current = setInterval(fetchContext, 30_000);
    healthIntervalRef.current = setInterval(fetchHealth, 60_000);
    return () => {
      if (contextIntervalRef.current) clearInterval(contextIntervalRef.current);
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
    };
  }, [fetchContext, fetchHealth]);

  // ── Startup greeting ────────────────────────────────────────────────────────
  useEffect(() => {
    if (introFiredRef.current) return;
    introFiredRef.current = true;
    // Give voices time to load before speaking
    const timer = setTimeout(() => {
      speak('VEGA systems online. Say VEGA to begin.');
    }, 1_200);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Action handlers ─────────────────────────────────────────────────────────
  const approveAction = useCallback(async () => {
    const action = stateRef.current.pendingAction;
    if (!action) return;
    dispatch({ type: 'CLEAR_PENDING_ACTION' });
    try {
      const result = await api.executeCommand({
        command: action.type,
        params: action.params,
        sessionId: stateRef.current.sessionId,
        approved: true,
      });
      dispatch({
        type: 'ADD_COMMAND_HISTORY',
        item: { type: action.type, timestamp: new Date().toISOString(), success: result.success, mode: stateRef.current.mode },
      });
      const confirmMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant',
        content: result.success ? `✓ ${result.message}` : `✗ Command failed: ${result.message}`,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_ASSISTANT_MESSAGE', message: confirmMsg, suggestions: [] });
      speak(result.message);
    } catch (err) {
      dispatch({
        type: 'ADD_COMMAND_HISTORY',
        item: { type: action.type, timestamp: new Date().toISOString(), success: false, mode: stateRef.current.mode },
      });
      const errMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant',
        content: `✗ Command failed: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_ASSISTANT_MESSAGE', message: errMsg, suggestions: [] });
    }
  }, [speak]);

  const rejectAction = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_ACTION' });
    const msg: ChatMessage = {
      id: uuidv4(), role: 'assistant', content: 'Action rejected. No changes were made.',
      timestamp: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_ASSISTANT_MESSAGE', message: msg, suggestions: [] });
    speak('Action rejected. No changes were made.');
  }, [speak]);

  // ── Orb mode mapping ────────────────────────────────────────────────────────
  const orbMode: OrbMode = (() => {
    if (conversationMode === 'listening') return 'listening';
    if (conversationMode === 'processing') return 'processing';
    if (conversationMode === 'speaking' || isSpeaking) return 'speaking';
    return 'idle';
  })();

  // ── Status bar ──────────────────────────────────────────────────────────────
  const isHealthy = state.health?.status === 'healthy';
  const healthColor = isHealthy ? '#2ea043' : state.health ? '#f0883e' : '#484f58';
  const healthLabel = state.health ? state.health.status.toUpperCase() : 'CONNECTING...';

  const modeColors: Record<AssistantMode, string> = {
    readonly: '#484f58',
    approval_required: '#f0883e',
    autonomous: '#2ea043',
  };

  const voiceStatusColor = (() => {
    if (!wakeSupported) return '#484f58';
    if (isSpeaking) return '#00d4aa';
    if (isListeningForWake || conversationActive) return '#00ff88';
    return '#484f58';
  })();

  const voiceStatusLabel = (() => {
    if (!wakeSupported) return 'VOICE N/A';
    if (conversationMode === 'listening') return 'LISTENING';
    if (conversationMode === 'processing') return 'THINKING';
    if (isSpeaking) return 'SPEAKING';
    if (isListeningForWake) return 'WAKE ACTIVE';
    return 'STANDBY';
  })();

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d1117; color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', monospace; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #0d1117; }
        ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
        @keyframes ripple { 0%{transform:scale(1);opacity:1} 100%{transform:scale(1.8);opacity:0} }
        button:focus-visible { outline: 2px solid #00d4aa; outline-offset: 2px; }
        [role="button"]:focus-visible { outline: 2px solid #00d4aa; outline-offset: 3px; }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 1400, margin: '0 auto', padding: '0 16px' }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 0', borderBottom: '1px solid #21262d', flexShrink: 0,
        }}>
          {/* Left: logo + orb + mode badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 24, color: '#00d4aa' }}>⬡</div>
            <div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 20, letterSpacing: 3, color: '#00d4aa' }}>
                VEGA
              </div>
              <div style={{ color: '#484f58', fontSize: 11, letterSpacing: 1 }}>
                VOICE-ENABLED GUIDANCE AGENT
              </div>
            </div>

            {/* Animated orb */}
            <VegaOrb mode={orbMode} onClick={() => {
              if (conversationActive || isSpeaking) {
                deactivate();
              } else {
                activate();
              }
            }} />

            {/* Mode badge */}
            <span style={{
              padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: modeColors[state.mode] + '22',
              color: modeColors[state.mode], border: `1px solid ${modeColors[state.mode]}44`,
              textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {state.mode.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Right: mode selector + mute toggle */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Voice status pill */}
            {wakeSupported && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 20,
                border: `1px solid ${voiceStatusColor}44`,
                background: voiceStatusColor + '11',
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: voiceStatusColor, display: 'inline-block',
                  boxShadow: conversationActive || isListeningForWake ? `0 0 6px ${voiceStatusColor}` : undefined,
                }} />
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: voiceStatusColor, letterSpacing: 1 }}>
                  {voiceStatusLabel}
                </span>
              </div>
            )}

            {/* Mute toggle */}
            <button
              onClick={() => setMuted(m => !m)}
              title={muted ? 'Unmute VEGA voice' : 'Mute VEGA voice'}
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid #30363d',
                background: muted ? '#2d1d0b' : 'transparent',
                color: muted ? '#f0883e' : '#484f58',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {muted ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
              {muted ? 'MUTED' : 'VOICE'}
            </button>

            {/* Mode selector */}
            {(['readonly', 'approval_required', 'autonomous'] as AssistantMode[]).map(m => (
              <button key={m} onClick={() => dispatch({ type: 'SET_MODE', mode: m })}
                style={{
                  padding: '5px 12px', borderRadius: 6, border: '1px solid #30363d',
                  background: state.mode === m ? '#21262d' : 'transparent',
                  color: state.mode === m ? modeColors[m] : '#484f58',
                  cursor: 'pointer', fontFamily: 'monospace', fontSize: 11,
                  textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: state.mode === m ? 700 : 400,
                }}>
                {m.replace(/_/g, '-')}
              </button>
            ))}
          </div>
        </div>

        {/* ── Voice hint banner (shows when not supported) ──────────────── */}
        {!wakeSupported && (
          <div style={{
            padding: '6px 12px', background: '#1c1500', borderBottom: '1px solid #f0883e33',
            color: '#8b949e', fontSize: 12, fontFamily: 'monospace',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f0883e" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Voice recognition not available in this browser. Use Chrome for full Jarvis experience.
            {voiceName && <span style={{ marginLeft: 'auto', color: '#484f58' }}>TTS: {voiceName}</span>}
          </div>
        )}

        {/* ── Main content ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden', padding: '16px 0' }}>

          {/* Left: Chat */}
          <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ChatInterface
              messages={state.messages}
              onSend={(msg) => sendMessage(msg, false)}
              loading={state.chatLoading}
              error={state.chatError}
              suggestions={state.suggestions}
              voiceEnabled={true}
              inputValue={state.inputValue}
              onInputChange={(v) => dispatch({ type: 'SET_INPUT', value: v })}
              pendingAction={state.pendingAction}
            />
          </div>

          {/* Right: Dashboard */}
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
            <StatusCards context={state.context} loading={state.contextLoading} />
            <PredictionsPanel
              predictions={state.context?.predictions ?? []}
              loading={state.contextLoading}
            />
            <CommandHistory commands={state.commandHistory} />
          </div>
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div style={{
          padding: '10px 0', borderTop: '1px solid #21262d',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: healthColor, display: 'inline-block' }} />
          <span style={{ color: '#484f58', fontSize: 12, fontFamily: 'monospace' }}>
            {healthLabel}
            {state.health && ` · ${state.health.assistantName} v${state.health.version}`}
            {state.context && ` · Updated ${new Date(state.context.lastUpdated).toLocaleTimeString()}`}
          </span>
          {voiceName && wakeSupported && (
            <span style={{ marginLeft: 'auto', color: '#484f58', fontSize: 11, fontFamily: 'monospace' }}>
              Voice: {voiceName}
            </span>
          )}
        </div>
      </div>

      {/* ── Trade approval modal ─────────────────────────────────────── */}
      <TradeApproval
        action={state.pendingAction}
        onApprove={approveAction}
        onReject={rejectAction}
      />
    </>
  );
}
