import { useState, useRef, useEffect, useCallback } from 'react';

interface UseJarvisVoiceResult {
  speak: (text: string, onEnd?: () => void) => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  voiceName: string;
}

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;

  // Priority 1: Google UK English Male
  const googleUK = voices.find(v => v.name === 'Google UK English Male');
  if (googleUK) return googleUK;

  // Priority 2: Any en-GB male voice (heuristic: name contains "male" or "daniel" or "oliver")
  const enGBMale = voices.find(
    v => v.lang === 'en-GB' && /male|daniel|oliver|george/i.test(v.name)
  );
  if (enGBMale) return enGBMale;

  // Priority 3: Any en-GB voice
  const enGB = voices.find(v => v.lang === 'en-GB');
  if (enGB) return enGB;

  // Priority 4: Any en-US male voice
  const enUSMale = voices.find(
    v => v.lang.startsWith('en') && /male|david|mark|alex/i.test(v.name)
  );
  if (enUSMale) return enUSMale;

  // Priority 5: Any English voice
  const anyEnglish = voices.find(v => v.lang.startsWith('en'));
  if (anyEnglish) return anyEnglish;

  // Fallback: first available voice
  return voices[0];
}

export function useJarvisVoice(): UseJarvisVoiceResult {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceName, setVoiceName] = useState('');

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const mountedRef = useRef(true);
  const onEndRef = useRef<(() => void) | undefined>(undefined);

  const loadVoices = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      const picked = pickVoice(voices);
      voiceRef.current = picked;
      setVoiceName(picked?.name ?? 'Default');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    // Voices may already be loaded (Chrome pre-loads them)
    loadVoices();

    // Or load async
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      mountedRef.current = false;
      // Cancel any ongoing speech on unmount
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    };
  }, [loadVoices]);

  const stopSpeaking = useCallback(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
    utteranceRef.current = null;
    if (mountedRef.current) setIsSpeaking(false);
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onEnd?.();
      return;
    }
    if (!text.trim()) {
      onEnd?.();
      return;
    }

    // Cancel anything currently playing
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }

    onEndRef.current = onEnd;

    const utterance = new SpeechSynthesisUtterance(text);

    // Apply voice if we have one
    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
    }

    // Jarvis-like: deep, measured, precise
    utterance.pitch = 0.88;
    utterance.rate = 0.92;
    utterance.volume = 1.0;

    utterance.onstart = () => {
      if (mountedRef.current) setIsSpeaking(true);
    };

    utterance.onend = () => {
      if (!mountedRef.current) return;
      setIsSpeaking(false);
      utteranceRef.current = null;
      onEndRef.current?.();
      onEndRef.current = undefined;
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (!mountedRef.current) return;
      // 'interrupted' is not a real error — it just means we cancelled it ourselves
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.warn('[VEGA TTS] error:', event.error);
      }
      setIsSpeaking(false);
      utteranceRef.current = null;
      // Still fire onEnd so conversation flow continues
      onEndRef.current?.();
      onEndRef.current = undefined;
    };

    utteranceRef.current = utterance;

    // Chrome bug: speechSynthesis sometimes gets stuck; a short delay avoids it
    setTimeout(() => {
      if (mountedRef.current && utteranceRef.current === utterance) {
        window.speechSynthesis.speak(utterance);
      }
    }, 50);
  }, []);

  return { speak, stopSpeaking, isSpeaking, voiceName };
}
