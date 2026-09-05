"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Narrator,
  SILENT_MOUTH,
  unlockAudioContext,
  type MouthFrame,
  type NarrationRequest,
  type NarrationStatus,
} from "./audio-engine";

export interface UseNarratorResult {
  status: NarrationStatus;
  isSpeaking: boolean;
  /** True when audio could not be started at all and the UI should offer a tap-to-play control. */
  isBlocked: boolean;
  speak: (request: NarrationRequest) => void;
  replayLast: () => void;
  stop: () => void;
  /** Stable reference safe to call from a requestAnimationFrame loop. */
  readMouthFrame: () => MouthFrame;
  /** Call synchronously from a click handler before any await. */
  unlock: () => void;
}

/**
 * React wrapper around the Narrator. The narrator instance itself is created
 * lazily on the client so the module never touches window during SSR.
 */
export function useNarrator(): UseNarratorResult {
  const [status, setStatus] = useState<NarrationStatus>("idle");
  const narratorRef = useRef<Narrator | null>(null);

  const getNarrator = useCallback((): Narrator | null => {
    if (typeof window === "undefined") return null;
    if (!narratorRef.current) {
      narratorRef.current = new Narrator({ onStatusChange: setStatus });
    }
    return narratorRef.current;
  }, []);

  useEffect(() => {
    return () => {
      narratorRef.current?.dispose();
      narratorRef.current = null;
    };
  }, []);

  const speak = useCallback(
    (request: NarrationRequest) => {
      const narrator = getNarrator();
      if (!narrator) return;
      // Fire-and-forget on purpose: speak() resolves once playback starts and
      // handles every failure internally, so there is nothing to await and
      // nothing that can reject into the dev overlay.
      void narrator.speak(request);
    },
    [getNarrator],
  );

  const replayLast = useCallback(() => {
    void getNarrator()?.replayLast();
  }, [getNarrator]);

  const stop = useCallback(() => {
    narratorRef.current?.stop();
  }, []);

  const readMouthFrame = useCallback((): MouthFrame => {
    return narratorRef.current?.readMouthFrame() ?? SILENT_MOUTH;
  }, []);

  const unlock = useCallback(() => {
    unlockAudioContext();
    // Instantiating here too means the very first turn already has a narrator
    // wired to the freshly unlocked context.
    getNarrator();
  }, [getNarrator]);

  // NOTE FOR CALLERS: this object's identity changes on every status change,
  // because `status` has to propagate to render. The individual methods
  // (speak/stop/replayLast/readMouthFrame/unlock) are stable across renders —
  // depend on THOSE in an effect, never on the returned object. Putting the
  // object in a cleanup effect's dependency array calls stop() the moment
  // speaking begins and silently cancels the utterance.
  return useMemo(
    () => ({
      status,
      isSpeaking: status === "speaking",
      isBlocked: status === "blocked",
      speak,
      replayLast,
      stop,
      readMouthFrame,
      unlock,
    }),
    [status, speak, replayLast, stop, readMouthFrame, unlock],
  );
}
