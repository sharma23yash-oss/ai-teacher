"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SPEECH_RECOGNITION_LOCALES, type Language } from "./types";

function getSpeechRecognitionImpl(): typeof SpeechRecognition | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

// Feature support never changes after mount, so subscribe is a no-op. Using
// useSyncExternalStore (rather than a plain useState + useEffect) lets the
// client-only detection differ from the server snapshot without triggering
// a hydration mismatch — this hook is the sanctioned escape hatch for
// exactly that case.
function subscribeNoop() {
  return () => {};
}
function getSupportSnapshot() {
  return Boolean(getSpeechRecognitionImpl());
}
function getServerSupportSnapshot() {
  return false;
}

function describeError(code: SpeechRecognitionErrorCode, locale: string): string {
  switch (code) {
    case "audio-capture":
      return "No microphone found.";
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was blocked.";
    case "network":
      return "Speech recognition network error.";
    case "language-not-supported":
      return `This browser can't recognise ${locale}.`;
    default:
      return "Speech recognition isn't available right now.";
  }
}

// Chrome rejects start() with InvalidStateError while a previous session is
// still handing the microphone back — exactly what happens when switching
// language tears down one recogniser and builds another. Swallowing that
// error leaves the mic permanently dead while the UI still says "Listening",
// so every start path backs off and retries instead.
const START_RETRY_DELAYS_MS = [120, 260, 520, 900, 1500];

// Restarting a "continuous" session that the browser keeps ending immediately
// (no mic, revoked permission, an unsupported locale) would otherwise spin.
const RESTART_WINDOW_MS = 3000;
const MAX_RESTARTS_PER_WINDOW = 6;

export interface UseSpeechRecognitionOptions {
  /**
   * Drives recognition.lang. en-IN for English; hi-IN for Hindi AND Hinglish
   * (see SPEECH_RECOGNITION_LOCALES for why Hinglish differs from its TTS voice).
   */
  language: Language;
  /**
   * Pauses capture without clearing the user's hands-free intent. Set while
   * the teacher is speaking so the microphone doesn't transcribe the avatar's
   * own voice back into the chat.
   */
  suspended?: boolean;
  onInterimTranscript: (transcript: string) => void;
  onFinalTranscript: (transcript: string) => void;
}

export interface UseSpeechRecognitionResult {
  isSupported: boolean;
  isListening: boolean;
  /** True when the user wants the mic on but it is paused (teacher speaking). */
  isPaused: boolean;
  /** The BCP-47 tag currently in use, surfaced for the UI. */
  locale: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Reports live interim text as the student talks (so the caller can render a
 * preview), and separately fires once per finalized result segment with just
 * that segment's transcript — the caller is expected to send it immediately
 * rather than wait for more speech, since `continuous` mode keeps the session
 * open for further turns.
 *
 * The engine is pinned to an Indian locale, and the tag can only be set before
 * start(), so a language change tears the session down and rebuilds it.
 */
export function useSpeechRecognition({
  language,
  suspended = false,
  onInterimTranscript,
  onFinalTranscript,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionResult {
  const locale = SPEECH_RECOGNITION_LOCALES[language];

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onInterimTranscriptRef = useRef(onInterimTranscript);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  useLayoutEffect(() => {
    onInterimTranscriptRef.current = onInterimTranscript;
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onInterimTranscript, onFinalTranscript]);

  // Index of the first result in the current session's event.results that
  // hasn't been finalized (and reported via onFinalTranscript) yet.
  const nextUnprocessedResultIndexRef = useRef(0);
  // The user's standing intent, independent of whether a session is currently
  // open. Survives locale swaps, suspend/resume, and the browser silently
  // ending a "continuous" session (which Chrome does every ~60s).
  const wantsToListenRef = useRef(false);
  // Mirrors the `suspended` prop for handlers that would otherwise close over
  // the first render's value.
  const suspendedRef = useRef(suspended);
  // Set on an error that won't get better by retrying (permission denied, no
  // mic) so nothing spins in a restart/error loop.
  const fatalErrorRef = useRef(false);
  const restartWindowStartRef = useRef(0);
  const restartCountRef = useRef(0);
  // Owned by the live effect: every start path goes through this so they all
  // get the same InvalidStateError backoff.
  const startWithRetryRef = useRef<(() => void) | null>(null);

  const isSupported = useSyncExternalStore(
    subscribeNoop,
    getSupportSnapshot,
    getServerSupportSnapshot,
  );
  const [isListening, setIsListening] = useState(false);
  // Mirrors wantsToListenRef for rendering — the ref is what the event
  // handlers read, but a ref must not be read during render.
  const [wantsToListen, setWantsToListen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Impl = getSpeechRecognitionImpl();
    if (!Impl) return;

    const recognition = new Impl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = locale;
    // One alternative is enough once the locale is right; extra hypotheses
    // only add latency for a transcript we take verbatim.
    recognition.maxAlternatives = 1;

    let disposed = false;
    const pendingRetries = new Set<ReturnType<typeof setTimeout>>();

    function startWithRetry(attempt = 0) {
      if (disposed) return;
      if (!wantsToListenRef.current || suspendedRef.current) return;
      if (fatalErrorRef.current) return;
      try {
        recognition.start();
      } catch {
        // The previous session hasn't released the device yet. Back off and
        // try again rather than leaving a dead microphone behind a UI that
        // claims to be listening.
        if (attempt >= START_RETRY_DELAYS_MS.length) {
          wantsToListenRef.current = false;
          setWantsToListen(false);
          setError("Couldn't reopen the microphone — tap the mic to try again.");
          return;
        }
        const timer = setTimeout(() => {
          pendingRetries.delete(timer);
          startWithRetry(attempt + 1);
        }, START_RETRY_DELAYS_MS[attempt]);
        pendingRetries.add(timer);
      }
    }
    startWithRetryRef.current = () => startWithRetry(0);

    recognition.onstart = () => {
      nextUnprocessedResultIndexRef.current = 0;
      fatalErrorRef.current = false;
      setIsListening(true);
      setError(null);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Hands-free mode: the browser can end a "continuous" session on its own
      // well before the user asks to stop, so keep it alive by restarting —
      // unless the user turned the mic off, the teacher is speaking, or the
      // last error means restarting would just fail again immediately.
      if (!wantsToListenRef.current || suspendedRef.current || fatalErrorRef.current) return;

      const now = Date.now();
      if (now - restartWindowStartRef.current > RESTART_WINDOW_MS) {
        restartWindowStartRef.current = now;
        restartCountRef.current = 0;
      }
      restartCountRef.current += 1;
      if (restartCountRef.current > MAX_RESTARTS_PER_WINDOW) {
        wantsToListenRef.current = false;
        setWantsToListen(false);
        setError("Voice input keeps dropping — check your microphone and try again.");
        return;
      }
      startWithRetry(0);
    };

    recognition.onerror = (event) => {
      // "no-speech" and "aborted" are routine in a long hands-free session —
      // surfacing them would flash an error banner between every sentence.
      if (event.error === "no-speech" || event.error === "aborted") return;

      setError(describeError(event.error, locale));
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture" ||
        event.error === "language-not-supported"
      ) {
        fatalErrorRef.current = true;
        wantsToListenRef.current = false;
        setWantsToListen(false);
      }
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      for (let i = nextUnprocessedResultIndexRef.current; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          nextUnprocessedResultIndexRef.current = i + 1;
          if (text.trim()) onFinalTranscriptRef.current(text.trim());
        } else {
          interimTranscript += text;
        }
      }
      if (interimTranscript) onInterimTranscriptRef.current(interimTranscript);
    };

    recognitionRef.current = recognition;

    // A locale change recreates the instance mid-session; carry the user's
    // hands-free intent over to the new one instead of silently going deaf.
    startWithRetry(0);

    return () => {
      disposed = true;
      pendingRetries.forEach(clearTimeout);
      pendingRetries.clear();
      startWithRetryRef.current = null;
      recognition.onstart = null;
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
      recognitionRef.current = null;
      // onend is detached above, so nothing else will clear this — without it
      // the UI keeps claiming to listen through a locale swap.
      setIsListening(false);
    };
  }, [locale]);

  // Pause/resume around the teacher's own speech.
  useEffect(() => {
    suspendedRef.current = suspended;
    if (!wantsToListenRef.current) return;
    if (suspended) {
      recognitionRef.current?.stop();
      return;
    }
    startWithRetryRef.current?.();
  }, [suspended]);

  useEffect(() => {
    return () => {
      wantsToListenRef.current = false;
    };
  }, []);

  const start = useCallback(() => {
    wantsToListenRef.current = true;
    setWantsToListen(true);
    fatalErrorRef.current = false;
    restartCountRef.current = 0;
    restartWindowStartRef.current = Date.now();
    setError(null);
    startWithRetryRef.current?.();
  }, []);

  const stop = useCallback(() => {
    wantsToListenRef.current = false;
    setWantsToListen(false);
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (wantsToListenRef.current) stop();
    else start();
  }, [start, stop]);

  return {
    isSupported,
    isListening,
    isPaused: suspended && wantsToListen,
    locale,
    error,
    start,
    stop,
    toggle,
  };
}
