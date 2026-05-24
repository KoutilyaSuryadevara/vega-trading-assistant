import { useState, useRef, useCallback, useEffect } from 'react';

export type ConversationMode = 'idle' | 'wake_detected' | 'listening' | 'processing' | 'speaking';

interface UseConversationOptions {
  speak: (text: string, onEnd?: () => void) => void;
  stopSpeaking: () => void;
  onQuery: (transcript: string) => void;
}

interface UseConversationResult {
  conversationMode: ConversationMode;
  activate: (initialTranscript?: string) => void;
  deactivate: () => void;
  captureQuery: () => void;
  setMode: (mode: ConversationMode) => void;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

const LISTEN_TIMEOUT_MS = 8_000;
const STANDBY_PHRASE = "I'll be standing by.";
const WAKE_ACK_PHRASE = "Yes, I'm listening.";

export function useConversation({ speak, stopSpeaking, onQuery }: UseConversationOptions): UseConversationResult {
  const [conversationMode, setConversationMode] = useState<ConversationMode>('idle');

  const SpeechRecognitionAPI =
    typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const modeRef = useRef<ConversationMode>('idle');

  // Keep modeRef in sync so callbacks always see the current mode
  const updateMode = useCallback((mode: ConversationMode) => {
    modeRef.current = mode;
    if (mountedRef.current) setConversationMode(mode);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
      }
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const goIdle = useCallback(() => {
    clearTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }
    updateMode('idle');
  }, [clearTimer, updateMode]);

  const captureQuery = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      goIdle();
      return;
    }

    // Abort any existing capture
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    updateMode('listening');

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    // Timeout: if no speech in 8 seconds, go to standby
    clearTimer();
    timeoutRef.current = setTimeout(() => {
      if (modeRef.current === 'listening') {
        try { recognition.stop(); } catch { /* ignore */ }
        speak(STANDBY_PHRASE, () => {
          if (mountedRef.current) goIdle();
        });
      }
    }, LISTEN_TIMEOUT_MS);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      clearTimer();
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) {
        updateMode('processing');
        onQuery(transcript);
      } else {
        speak(STANDBY_PHRASE, () => {
          if (mountedRef.current) goIdle();
        });
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      clearTimer();
      if (!mountedRef.current) return;
      if (event.error === 'no-speech') {
        speak(STANDBY_PHRASE, () => {
          if (mountedRef.current) goIdle();
        });
      } else {
        goIdle();
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      goIdle();
    }
  }, [SpeechRecognitionAPI, clearTimer, goIdle, onQuery, speak, updateMode]);

  const activate = useCallback((initialTranscript?: string) => {
    if (!mountedRef.current) return;

    stopSpeaking();
    updateMode('wake_detected');

    // If the wake word utterance already contained a query (e.g. "VEGA what's my P&L"),
    // skip the ack and go straight to processing.
    if (initialTranscript && initialTranscript.trim().length > 2) {
      updateMode('processing');
      onQuery(initialTranscript.trim());
      return;
    }

    // Otherwise: acknowledge, then open mic
    speak(WAKE_ACK_PHRASE, () => {
      if (!mountedRef.current) return;
      captureQuery();
    });
  }, [captureQuery, onQuery, speak, stopSpeaking, updateMode]);

  const deactivate = useCallback(() => {
    stopSpeaking();
    goIdle();
  }, [goIdle, stopSpeaking]);

  return {
    conversationMode,
    activate,
    deactivate,
    captureQuery,
    setMode: updateMode,
  };
}
