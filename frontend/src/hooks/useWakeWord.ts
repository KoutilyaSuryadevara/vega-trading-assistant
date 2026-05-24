import { useState, useRef, useEffect, useCallback } from 'react';

interface UseWakeWordOptions {
  onWake: (restOfTranscript: string) => void;
  isSpeaking: boolean;
  enabled?: boolean;
}

interface UseWakeWordResult {
  isListeningForWake: boolean;
  isSupported: boolean;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

const WAKE_WORD = 'vega';

export function useWakeWord({ onWake, isSpeaking, enabled = true }: UseWakeWordOptions): UseWakeWordResult {
  const [isListeningForWake, setIsListeningForWake] = useState(false);

  const SpeechRecognitionAPI =
    typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;

  const isSupported = !!SpeechRecognitionAPI && enabled;

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isSpeakingRef = useRef(isSpeaking);
  const enabledRef = useRef(enabled);
  const mountedRef = useRef(true);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWakeRef = useRef(onWake);

  // Keep refs in sync so event handlers don't close over stale values
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { onWakeRef.current = onWake; }, [onWake]);

  const stopRecognition = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
    setIsListeningForWake(false);
  }, []);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI || !mountedRef.current || !enabledRef.current) return;
    if (isSpeakingRef.current) return; // don't listen while speaking

    // Clean up any existing instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (mountedRef.current) setIsListeningForWake(true);
    };

    recognition.onend = () => {
      if (!mountedRef.current) return;
      setIsListeningForWake(false);
      // Auto-restart unless speaking; debounce to avoid tight loops
      if (enabledRef.current && !isSpeakingRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (mountedRef.current && enabledRef.current && !isSpeakingRef.current) {
            startRecognition();
          }
        }, 300);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (!mountedRef.current) return;
      setIsListeningForWake(false);
      // For non-fatal errors, attempt restart; for permission errors, give up
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') return;
      if (event.error === 'no-speech' || event.error === 'audio-capture' || event.error === 'network') {
        restartTimerRef.current = setTimeout(() => {
          if (mountedRef.current && enabledRef.current && !isSpeakingRef.current) {
            startRecognition();
          }
        }, 1000);
      }
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!mountedRef.current) return;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim().toLowerCase();

        // Look for "vega" anywhere near the start (first word or two)
        const words = transcript.split(/\s+/);
        const wakeIndex = words.findIndex(w => w.replace(/[^a-z]/g, '') === WAKE_WORD);

        if (wakeIndex !== -1 && wakeIndex <= 1) {
          // Gather the rest of the phrase after the wake word
          const rest = words.slice(wakeIndex + 1).join(' ').trim();

          // Only fire on a final result or when we have meaningful content after wake word
          if (result.isFinal || rest.length > 2) {
            try { recognition.stop(); } catch { /* ignore */ }
            onWakeRef.current(rest);
            return;
          }
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // start() can throw if called while already running
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SpeechRecognitionAPI]);

  // Pause/resume when speaking state changes
  useEffect(() => {
    if (!isSupported) return;

    if (isSpeaking) {
      // Stop wake word detection while VEGA is speaking
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      setIsListeningForWake(false);
    } else {
      // Resume after a short delay to let audio settle
      restartTimerRef.current = setTimeout(() => {
        if (mountedRef.current && enabledRef.current) startRecognition();
      }, 500);
    }

    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    };
  }, [isSpeaking, isSupported, startRecognition]);

  // Start on mount, stop on unmount
  useEffect(() => {
    mountedRef.current = true;
    if (isSupported) {
      restartTimerRef.current = setTimeout(startRecognition, 800);
    }
    return () => {
      mountedRef.current = false;
      stopRecognition();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported]);

  return { isListeningForWake, isSupported };
}
