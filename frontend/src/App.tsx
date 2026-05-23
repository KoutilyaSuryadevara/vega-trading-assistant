import { useReducer, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { ChatInterface } from './components/ChatInterface';
import { StatusCards } from './components/StatusCards';
import { PredictionsPanel } from './components/PredictionsPanel';
import { CommandHistory } from './components/CommandHistory';
import { TradeApproval } from './components/TradeApproval';
import { api } from './services/api';
import type {
  ChatMessage, TradingContext, TradingCommand, AssistantMode,
  HealthResponse, CommandHistoryItem,
} from './types';

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
  const contextIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    } catch { /* health check failed silently */ }
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

  const sendMessage = useCallback(async (message: string) => {
    dispatch({ type: 'ADD_USER_MESSAGE', message });
    try {
      const response = await api.chat({ message, sessionId: state.sessionId, mode: state.mode });
      const assistantMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant', content: response.message, timestamp: response.timestamp,
      };
      dispatch({
        type: 'ADD_ASSISTANT_MESSAGE',
        message: assistantMsg,
        suggestions: response.suggestions ?? [],
        pendingAction: response.pendingAction,
      });
    } catch (err) {
      dispatch({ type: 'SET_CHAT_ERROR', error: (err as Error).message });
    }
  }, [state.sessionId, state.mode]);

  const approveAction = useCallback(async () => {
    const action = state.pendingAction;
    if (!action) return;
    dispatch({ type: 'CLEAR_PENDING_ACTION' });
    try {
      const result = await api.executeCommand({
        command: action.type,
        params: action.params,
        sessionId: state.sessionId,
        approved: true,
      });
      dispatch({
        type: 'ADD_COMMAND_HISTORY',
        item: { type: action.type, timestamp: new Date().toISOString(), success: result.success, mode: state.mode },
      });
      const confirmMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant',
        content: result.success ? `✓ ${result.message}` : `✗ Command failed: ${result.message}`,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_ASSISTANT_MESSAGE', message: confirmMsg, suggestions: [] });
    } catch (err) {
      dispatch({
        type: 'ADD_COMMAND_HISTORY',
        item: { type: action.type, timestamp: new Date().toISOString(), success: false, mode: state.mode },
      });
      const errMsg: ChatMessage = {
        id: uuidv4(), role: 'assistant',
        content: `✗ Command failed: ${(err as Error).message}`,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: 'ADD_ASSISTANT_MESSAGE', message: errMsg, suggestions: [] });
    }
  }, [state.pendingAction, state.sessionId, state.mode]);

  const rejectAction = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_ACTION' });
    const msg: ChatMessage = {
      id: uuidv4(), role: 'assistant', content: 'Action rejected. No changes were made.',
      timestamp: new Date().toISOString(),
    };
    dispatch({ type: 'ADD_ASSISTANT_MESSAGE', message: msg, suggestions: [] });
  }, []);

  const isHealthy = state.health?.status === 'healthy';
  const healthColor = isHealthy ? '#2ea043' : state.health ? '#f0883e' : '#484f58';
  const healthLabel = state.health ? state.health.status.toUpperCase() : 'CONNECTING...';

  const modeColors: Record<AssistantMode, string> = {
    readonly: '#484f58',
    approval_required: '#f0883e',
    autonomous: '#2ea043',
  };

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
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', maxWidth: 1400, margin: '0 auto', padding: '0 16px' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 0', borderBottom: '1px solid #21262d', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24, color: '#00d4aa' }}>⬡</div>
            <div>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 20, letterSpacing: 3, color: '#00d4aa' }}>
                VEGA
              </div>
              <div style={{ color: '#484f58', fontSize: 11, letterSpacing: 1 }}>
                VOICE-ENABLED GUIDANCE AGENT
              </div>
            </div>
            <span style={{
              padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: modeColors[state.mode] + '22',
              color: modeColors[state.mode], border: `1px solid ${modeColors[state.mode]}44`,
              textTransform: 'uppercase', letterSpacing: 1,
            }}>
              {state.mode.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Mode selector */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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

        {/* Main content */}
        <div style={{ display: 'flex', gap: 16, flex: 1, overflow: 'hidden', padding: '16px 0' }}>

          {/* Left: Chat */}
          <div style={{ flex: '0 0 60%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <ChatInterface
              messages={state.messages}
              onSend={sendMessage}
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

        {/* Footer */}
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
        </div>
      </div>

      {/* Trade approval modal */}
      <TradeApproval
        action={state.pendingAction}
        onApprove={approveAction}
        onReject={rejectAction}
      />
    </>
  );
}
