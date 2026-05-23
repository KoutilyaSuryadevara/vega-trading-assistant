import { useVoice } from '../hooks/useVoice';

interface Props {
  onTranscript: (text: string) => void;
  enabled: boolean;
}

export function VoiceInput({ onTranscript, enabled }: Props) {
  const { isListening, startListening, stopListening, isSupported, error } = useVoice({ onTranscript, enabled });

  if (!enabled || !isSupported) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={isListening ? stopListening : startListening}
        title={isListening ? 'Stop listening' : 'Start voice input'}
        style={{
          width: 36, height: 36, borderRadius: '50%', border: 'none',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isListening ? '#f85149' : '#21262d',
          transition: 'background 0.2s',
          position: 'relative',
          outline: 'none',
        }}
      >
        {isListening && (
          <span style={{
            position: 'absolute', inset: -3, borderRadius: '50%',
            border: '2px solid #f85149', animation: 'ripple 1s ease-in-out infinite',
          }} />
        )}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isListening ? '#fff' : '#8b949e'} strokeWidth="2">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      </button>
      {error && (
        <div style={{
          position: 'absolute', bottom: '120%', left: '50%', transform: 'translateX(-50%)',
          background: '#2d0b0b', border: '1px solid #f85149', borderRadius: 6,
          padding: '6px 10px', fontSize: 12, color: '#f85149', whiteSpace: 'nowrap',
          zIndex: 100,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
