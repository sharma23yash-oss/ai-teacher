import type { Language, TeacherPersona, VoiceGender } from "./types";

// ---------------------------------------------------------------------------
// Shared AudioContext
// ---------------------------------------------------------------------------
// Browsers only let an AudioContext leave the "suspended" state while a user
// gesture is on the stack. The bug this module exists to fix is that the app
// used to call audio.play() *after* awaiting Gemini + Edge TTS, by which point
// the click that started the turn is long gone and Chrome rejects playback
// with NotAllowedError.
//
// The fix is structural rather than defensive: unlockAudioContext() runs
// synchronously inside the click handler, so the context is already "running"
// by the time the audio bytes arrive. Playing through an AudioBufferSourceNode
// on a running context is not gated by the autoplay policy at all, so the
// error simply never happens on the happy path.

type AudioContextConstructor = new (contextOptions?: AudioContextOptions) => AudioContext;

interface AudioContextCapableWindow extends Window {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

let sharedContext: AudioContext | null = null;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as AudioContextCapableWindow;
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isAudioSupported(): boolean {
  return getAudioContextConstructor() !== null;
}

/**
 * Creates (once) and resumes the shared AudioContext. MUST be called
 * synchronously from a real user gesture handler — a click, a keypress, a
 * pointerdown — before any awaits in that handler.
 *
 * Safe to call on every interaction; it is a no-op once the context runs.
 */
export function unlockAudioContext(): AudioContext | null {
  const Ctor = getAudioContextConstructor();
  if (!Ctor) return null;

  if (!sharedContext) {
    try {
      sharedContext = new Ctor({ latencyHint: "interactive" });
    } catch {
      return null;
    }
  }

  // iOS/Safari additionally require that *some* buffer has been played from
  // the context inside a gesture before it will produce sound later.
  try {
    const primer = sharedContext.createBufferSource();
    primer.buffer = sharedContext.createBuffer(1, 1, sharedContext.sampleRate);
    primer.connect(sharedContext.destination);
    primer.start(0);
    primer.stop(sharedContext.currentTime + 0.001);
  } catch {
    // A context in an unusual state can refuse the primer; resume() below is
    // still worth attempting.
  }

  if (sharedContext.state !== "running") {
    // Deliberately not awaited: this runs inside a gesture handler and must
    // not introduce a microtask boundary. Rejection is expected when there is
    // no gesture and is handled by the caller reading `state` later.
    void sharedContext.resume().catch(() => undefined);
  }

  return sharedContext;
}

export function getAudioContext(): AudioContext | null {
  return sharedContext;
}

export function isAudioUnlocked(): boolean {
  return sharedContext?.state === "running";
}

// ---------------------------------------------------------------------------
// Narration
// ---------------------------------------------------------------------------

export type NarrationStatus = "idle" | "loading" | "speaking" | "blocked";

/** What the avatar's mouth should be doing for the current audio frame. */
export interface MouthFrame {
  /** 0 = closed, 1 = fully open. Already smoothed and gain-corrected. */
  level: number;
  /** 0 = wide (ah/ee), 1 = rounded (oo/oh). Derived from spectral tilt. */
  roundness: number;
}

export const SILENT_MOUTH: MouthFrame = { level: 0, roundness: 0.3 };

export interface NarrationRequest {
  text: string;
  persona: TeacherPersona;
  language: Language;
  voiceGender: VoiceGender;
}

export interface NarratorHandlers {
  onStatusChange: (status: NarrationStatus) => void;
}

const ANALYSER_FFT_SIZE = 1024;
// Speech RMS sits far below full scale; this maps a normal speaking level to
// roughly a fully open mouth without clipping every syllable to 1.
const LEVEL_GAIN = 5.2;
const LEVEL_ATTACK = 0.55;
const LEVEL_RELEASE = 0.18;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Owns one utterance at a time: fetches Edge TTS audio, plays it through the
 * shared AudioContext with an AnalyserNode tapped for lip-sync, and degrades
 * to the browser's own speechSynthesis when any of that is unavailable.
 *
 * Every failure path is handled locally and reported through `onStatusChange`
 * — nothing here rejects to an unhandled promise, which is what used to raise
 * the Next.js dev error overlay.
 */
export class Narrator {
  private readonly handlers: NarratorHandlers;
  private status: NarrationStatus = "idle";

  private source: AudioBufferSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  // Explicitly ArrayBuffer-backed: the analyser read methods reject the
  // SharedArrayBuffer-compatible widening of a bare Uint8Array.
  private timeDomain: Uint8Array<ArrayBuffer> = new Uint8Array(ANALYSER_FFT_SIZE);
  private frequency: Uint8Array<ArrayBuffer> = new Uint8Array(ANALYSER_FFT_SIZE / 2);

  private smoothedLevel = 0;
  private smoothedRoundness = 0.3;

  /** Incremented on every stop/new utterance so stale fetches are ignored. */
  private generation = 0;
  /** Kept so a "Listen" button can retry the exact same line after a block. */
  private lastRequest: NarrationRequest | null = null;
  /** Set while the speechSynthesis fallback is producing sound. */
  private synthesisActive = false;
  /**
   * Chrome garbage-collects a SpeechSynthesisUtterance that nothing else
   * references, which cuts the audio off part-way through. Holding it here
   * for the duration of playback is the standard workaround.
   */
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private synthesisPhase = 0;

  constructor(handlers: NarratorHandlers) {
    this.handlers = handlers;
  }

  private setStatus(next: NarrationStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.handlers.onStatusChange(next);
  }

  getStatus(): NarrationStatus {
    return this.status;
  }

  hasPendingUtterance(): boolean {
    return this.lastRequest !== null;
  }

  /**
   * Speaks `request`. Resolves when playback has *started* (or definitively
   * failed) — not when it finishes — so callers never block a UI update on the
   * length of the utterance.
   */
  async speak(request: NarrationRequest): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.lastRequest = request;
    this.setStatus("loading");

    let audioBytes: ArrayBuffer | null = null;
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: request.text,
          persona: request.persona,
          language: request.language,
          voiceGender: request.voiceGender,
        }),
      });
      if (res.ok) {
        audioBytes = await res.arrayBuffer();
      }
    } catch {
      // Offline, blocked, or the route is down — the browser voice below is
      // the intended degradation, not an error worth surfacing.
      audioBytes = null;
    }

    if (generation !== this.generation) return;

    if (audioBytes && audioBytes.byteLength > 0) {
      const played = await this.playBuffer(audioBytes, generation);
      if (played || generation !== this.generation) return;
    }

    if (generation !== this.generation) return;
    this.speakWithBrowserVoice(request, generation);
  }

  /** Retries the last utterance — used by the manual "Listen" affordance. */
  async replayLast(): Promise<void> {
    if (!this.lastRequest) return;
    unlockAudioContext();
    await this.speak(this.lastRequest);
  }

  private async playBuffer(bytes: ArrayBuffer, generation: number): Promise<boolean> {
    const ctx = unlockAudioContext();
    if (!ctx) return false;

    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // No gesture credit left. Fall through: a suspended context would
        // start the source silently, which is worse than the browser voice.
      }
    }
    if (generation !== this.generation) return true;
    if (ctx.state !== "running") return false;

    let decoded: AudioBuffer;
    try {
      // The ArrayBuffer is detached by decodeAudioData, so hand over a copy —
      // otherwise a retry would decode an empty buffer.
      decoded = await ctx.decodeAudioData(bytes.slice(0));
    } catch {
      return false;
    }
    if (generation !== this.generation) return true;

    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.6;

      const gain = ctx.createGain();
      gain.gain.value = 1;

      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);

      source.onended = () => {
        if (generation !== this.generation) return;
        this.teardownGraph();
        this.setStatus("idle");
      };

      this.source = source;
      this.analyser = analyser;
      this.gain = gain;
      this.timeDomain = new Uint8Array(analyser.fftSize);
      this.frequency = new Uint8Array(analyser.frequencyBinCount);

      source.start(0);
      this.setStatus("speaking");
      return true;
    } catch {
      this.teardownGraph();
      return false;
    }
  }

  private speakWithBrowserVoice(request: NarrationRequest, generation: number): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      this.setStatus("blocked");
      return;
    }

    try {
      window.speechSynthesis.cancel();
      // Chrome returns an empty voice list until the engine has loaded; asking
      // for it here primes that load so the retry below can pick an Indian voice.
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.addEventListener(
          "voiceschanged",
          () => {
            if (generation !== this.generation || this.synthesisActive) return;
            this.speakWithBrowserVoice(request, generation);
          },
          { once: true },
        );
      }

      const utterance = new SpeechSynthesisUtterance(request.text);
      this.activeUtterance = utterance;
      utterance.lang = request.language === "hindi" ? "hi-IN" : "en-IN";
      // The stock voices are noticeably faster than the Edge neural ones; this
      // keeps the fallback intelligible for Hinglish and technical terms.
      utterance.rate = request.language === "english" ? 0.95 : 0.85;
      utterance.pitch = request.voiceGender === "male" ? 0.9 : 1.05;

      const voices = window.speechSynthesis.getVoices();
      const preferredLang = request.language === "hindi" ? "hi-IN" : "en-IN";
      const match =
        voices.find((voice) => voice.lang === preferredLang) ??
        voices.find((voice) => voice.lang.startsWith(preferredLang.slice(0, 2))) ??
        voices.find((voice) => voice.lang.includes("IN"));
      if (match) utterance.voice = match;

      utterance.onstart = () => {
        if (generation !== this.generation) return;
        this.synthesisActive = true;
        this.setStatus("speaking");
      };
      const finish = () => {
        this.activeUtterance = null;
        if (generation !== this.generation) return;
        this.synthesisActive = false;
        this.setStatus("idle");
      };
      utterance.onend = finish;
      // "not-allowed" / "interrupted" arrive here rather than as a rejection.
      utterance.onerror = () => {
        this.activeUtterance = null;
        if (generation !== this.generation) return;
        this.synthesisActive = false;
        this.setStatus(this.status === "speaking" ? "idle" : "blocked");
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      this.activeUtterance = null;
      this.synthesisActive = false;
      this.setStatus("blocked");
    }
  }

  private teardownGraph(): void {
    try {
      this.source?.stop();
    } catch {
      // Already stopped or never started.
    }
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.gain?.disconnect();
    this.source = null;
    this.analyser = null;
    this.gain = null;
  }

  stop(): void {
    this.generation += 1;
    this.teardownGraph();
    this.synthesisActive = false;
    this.activeUtterance = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Cancelling an empty queue throws in some Safari builds.
      }
    }
    this.smoothedLevel = 0;
    this.setStatus("idle");
  }

  dispose(): void {
    this.stop();
    this.lastRequest = null;
  }

  /**
   * Current mouth shape. Reads the live analyser when playing Edge audio; the
   * speechSynthesis fallback exposes no signal, so a syllable-rate envelope
   * stands in so the avatar still looks like it is talking.
   */
  readMouthFrame(): MouthFrame {
    if (this.synthesisActive) {
      this.synthesisPhase += 0.19;
      const envelope =
        0.5 +
        0.28 * Math.sin(this.synthesisPhase) +
        0.16 * Math.sin(this.synthesisPhase * 2.7 + 1.1);
      this.smoothedLevel = clamp01(envelope);
      this.smoothedRoundness = 0.35 + 0.2 * Math.sin(this.synthesisPhase * 0.6);
      return { level: this.smoothedLevel, roundness: clamp01(this.smoothedRoundness) };
    }

    const analyser = this.analyser;
    if (!analyser) {
      this.smoothedLevel *= 0.7;
      return { level: this.smoothedLevel, roundness: this.smoothedRoundness };
    }

    analyser.getByteTimeDomainData(this.timeDomain);
    let sumSquares = 0;
    for (let i = 0; i < this.timeDomain.length; i++) {
      const centred = (this.timeDomain[i] - 128) / 128;
      sumSquares += centred * centred;
    }
    const rms = Math.sqrt(sumSquares / this.timeDomain.length);
    const target = clamp01(rms * LEVEL_GAIN);
    // Open fast, close slowly — mirrors how a jaw actually moves and stops the
    // mouth flickering shut between syllables.
    const coefficient = target > this.smoothedLevel ? LEVEL_ATTACK : LEVEL_RELEASE;
    this.smoothedLevel += (target - this.smoothedLevel) * coefficient;

    // Spectral centroid: energy concentrated low = rounded vowel (oo/oh),
    // energy spread high = wide vowel or a sibilant (ee/ss).
    analyser.getByteFrequencyData(this.frequency);
    let weighted = 0;
    let total = 0;
    for (let i = 0; i < this.frequency.length; i++) {
      const magnitude = this.frequency[i];
      weighted += magnitude * i;
      total += magnitude;
    }
    const centroid = total > 0 ? weighted / total / this.frequency.length : 0.3;
    const roundnessTarget = clamp01(1 - centroid * 3.2);
    this.smoothedRoundness += (roundnessTarget - this.smoothedRoundness) * 0.15;

    return { level: this.smoothedLevel, roundness: clamp01(this.smoothedRoundness) };
  }
}
