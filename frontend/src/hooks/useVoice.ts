import { useState, useRef, useCallback } from 'react';

interface UseVoiceOptions {
  onTranscript: (text: string) => void;
  enabled: boolean;
}

interface UseVoiceResult {
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
  error: string | null;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function useVoice({ onTranscript, enabled }: UseVoiceOptions): UseVoiceResult {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const SpeechRecognitionAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const isSupported = !!SpeechRecognitionAPI && enabled;

  const startListening = useCallback(() => {
    if (!isSupported || isListening) return;
    setError(null);

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript.trim()) onTranscript(transcript.trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      if (event.error === 'not-allowed') {
        setError('Microphone access denied. Check browser permissions.');
      } else if (event.error === 'no-speech') {
        setError(null); // not an error, just silence
      } else {
        setError(`Voice error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [isSupported, isListening, onTranscript, SpeechRecognitionAPI]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, startListening, stopListening, isSupported, error };
}
