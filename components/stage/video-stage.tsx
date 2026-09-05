"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Film, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import {
  LANGUAGE_META,
  LEARNER_LEVEL_OPTIONS,
  type Language,
  type LearnerLevel,
  type LessonPayload,
  type TeacherPersona,
  type VoiceGender,
} from "@/lib/types";
import {
  buildStoryboard,
  canExport,
  estimateNarrationSeconds,
  HEIGHT,
  loadNarration,
  paintFrame,
  recordLesson,
  WIDTH,
  type Narration,
  type Storyboard,
} from "@/lib/video/lesson-video";

type Phase = "idle" | "preparing" | "ready" | "playing" | "recording" | "error";

export interface VideoStageProps {
  lesson: LessonPayload;
  persona: TeacherPersona;
  language: Language;
  learnerLevel: LearnerLevel;
  voiceGender: VoiceGender;
}

function levelLabel(level: LearnerLevel): string {
  return LEARNER_LEVEL_OPTIONS.find((option) => option.value === level)?.label ?? level;
}

/**
 * The lesson video.
 *
 * The turn's script, visuals and concept plan are composed into a storyboard,
 * narrated by the same Edge neural voice the live tutor uses, and drawn to a
 * canvas frame by frame — then handed to MediaRecorder so the student can
 * download the file. Preview and export run the same painter, so what plays
 * here is exactly what lands on disk.
 */
export function VideoStage({
  lesson,
  persona,
  language,
  learnerLevel,
  voiceGender,
}: VideoStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const narrationRef = useRef<Narration | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordProgress, setRecordProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  // Mirrors downloadUrl so the unmount/teardown path can revoke it without
  // taking a dependency on the state value.
  const downloadUrlRef = useRef<string | null>(null);
  const [hasNarration, setHasNarration] = useState(false);

  const script = lesson.avatar_script;
  const exportSupported = typeof window !== "undefined" && canExport();

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      sourceRef.current?.stop();
    } catch {
      // Not started, or already stopped.
    }
    sourceRef.current = null;
  }, []);

  // A new teaching turn invalidates the prepared video entirely.
  //
  // The derived state is reset during render rather than in an effect —
  // "adjusting state when a prop changes" is the case React documents for
  // render-phase setState, and it avoids the extra commit (and the flash of a
  // stale video) that an effect would cause. The same pattern is used in
  // stage-panel.tsx to re-sync the Stage on a new turn.
  const [syncedScript, setSyncedScript] = useState(script);
  if (script !== syncedScript) {
    setSyncedScript(script);
    setBoard(null);
    setPhase("idle");
    setError(null);
    setHasNarration(false);
    setDownloadUrl(null);
  }

  // Teardown of the things React does not own: the animation loop, the audio
  // source, the decoded narration, and the blob URL. Keyed on the script, so
  // a new turn tears down the previous turn's resources; no state is touched.
  useEffect(() => {
    return () => {
      stopPlayback();
      narrationRef.current = null;
      if (downloadUrlRef.current) {
        URL.revokeObjectURL(downloadUrlRef.current);
        downloadUrlRef.current = null;
      }
    };
  }, [script, stopPlayback]);

  useEffect(() => {
    const audioContext = audioContextRef;
    return () => {
      void audioContext.current?.close().catch(() => {});
      audioContext.current = null;
    };
  }, []);

  const getAudioContext = useCallback((): AudioContext | null => {
    if (audioContextRef.current) return audioContextRef.current;
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      audioContextRef.current = new AudioCtor();
      return audioContextRef.current;
    } catch {
      return null;
    }
  }, []);

  /**
   * Fetches and decodes the narration, then builds the storyboard against its
   * real duration. If TTS is unavailable the video is still produced — with
   * captions timed to an estimated reading pace and a silent track — because
   * a silent lesson video beats an error message.
   */
  const prepare = useCallback(async (): Promise<Storyboard | null> => {
    setPhase("preparing");
    setError(null);

    let narration: Narration | null = null;
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, persona, language, voiceGender }),
      });
      if (response.ok) {
        const context = getAudioContext();
        if (context) {
          narration = await loadNarration(context, await response.arrayBuffer());
        }
      }
    } catch (cause) {
      console.warn("Narration unavailable for the lesson video:", cause);
    }

    narrationRef.current = narration;
    setHasNarration(Boolean(narration));

    const next = buildStoryboard(lesson, {
      persona,
      languageLabel: LANGUAGE_META[language]?.label ?? language,
      levelLabel: levelLabel(learnerLevel),
      narrationSeconds: narration?.seconds ?? estimateNarrationSeconds(script),
    });

    setBoard(next);
    setPhase("ready");

    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) paintFrame(ctx, next, 0, narration?.envelope ?? null);

    return next;
  }, [script, persona, language, voiceGender, learnerLevel, lesson, getAudioContext]);

  const play = useCallback(
    async (prepared?: Storyboard) => {
      const active = prepared ?? board ?? (await prepare());
      if (!active) return;

      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;

      stopPlayback();
      setPhase("playing");

      const narration = narrationRef.current;
      const context = getAudioContext();

      if (narration && context) {
        try {
          await context.resume();
          const source = context.createBufferSource();
          source.buffer = narration.buffer;
          source.connect(context.destination);
          source.start(context.currentTime + active.narrationStart);
          sourceRef.current = source;
        } catch {
          // Autoplay policy refused; the video plays silently.
        }
      }

      startedAtRef.current = performance.now();
      const tick = () => {
        const elapsed = (performance.now() - startedAtRef.current) / 1000;
        if (elapsed >= active.duration) {
          paintFrame(ctx, active, active.duration - 0.01, narration?.envelope ?? null);
          setPhase("ready");
          rafRef.current = null;
          return;
        }
        paintFrame(ctx, active, elapsed, narration?.envelope ?? null);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [board, prepare, stopPlayback, getAudioContext],
  );

  const handlePrimary = useCallback(async () => {
    if (phase === "playing") {
      stopPlayback();
      setPhase("ready");
      return;
    }
    try {
      if (phase === "idle") {
        const prepared = await prepare();
        if (prepared) await play(prepared);
      } else {
        await play();
      }
    } catch (cause) {
      console.error("Lesson video failed:", cause);
      setError(cause instanceof Error ? cause.message : "Couldn't build the lesson video.");
      setPhase("error");
    }
  }, [phase, prepare, play, stopPlayback]);

  const handleDownload = useCallback(async () => {
    try {
      stopPlayback();
      const active = board ?? (await prepare());
      if (!active) return;

      setPhase("recording");
      setRecordProgress(0);

      const blob = await recordLesson({
        board: active,
        narration: narrationRef.current,
        onProgress: setRecordProgress,
      });

      const url = URL.createObjectURL(blob);
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current);
      downloadUrlRef.current = url;
      setDownloadUrl(url);

      const link = document.createElement("a");
      link.href = url;
      const slug = active.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      link.download = `ai-teacher-${slug || "lesson"}.webm`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setPhase("ready");
    } catch (cause) {
      console.error("Lesson video export failed:", cause);
      setError(cause instanceof Error ? cause.message : "Couldn't record the lesson video.");
      setPhase("error");
    }
  }, [board, prepare, stopPlayback]);

  const busy = phase === "preparing" || phase === "recording";

  return (
    <div className="flex h-full w-full flex-col gap-3 p-5">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="max-h-full max-w-full rounded-xl border border-white/10 bg-slate-950 shadow-2xl"
          style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        />

        {phase === "idle" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-950/70 text-center">
            <Film size={30} className="text-indigo-400" />
            <p className="text-sm font-medium text-slate-200">
              Generate this lesson as a narrated video
            </p>
            <p className="max-w-sm text-xs text-slate-400">
              The AI teacher presents this turn with voice, lip-sync, on-screen visuals and
              captions — and you can download the file.
            </p>
          </div>
        )}

        {busy && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-slate-950/80">
            <Loader2 size={26} className="animate-spin text-indigo-400" />
            <p className="text-sm text-slate-200">
              {phase === "preparing" ? "Composing the lesson…" : "Recording the video…"}
            </p>
            {phase === "recording" && (
              <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-[width] duration-150"
                  style={{ width: `${Math.round(recordProgress * 100)}%` }}
                />
              </div>
            )}
            {phase === "recording" && (
              <p className="text-xs text-slate-500">
                Recording runs in real time — about {Math.ceil(board?.duration ?? 0)} seconds.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={handlePrimary}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "playing" ? <Pause size={14} /> : <Play size={14} />}
          {phase === "playing"
            ? "Pause"
            : phase === "idle"
              ? "Generate teaching video"
              : "Play lesson"}
        </button>

        {phase !== "idle" && (
          <button
            onClick={() => void play()}
            disabled={busy || phase === "playing"}
            title="Replay from the start"
            className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={13} />
            Replay
          </button>
        )}

        <button
          onClick={handleDownload}
          disabled={busy || !exportSupported}
          title={
            exportSupported
              ? "Record this lesson to a video file"
              : "This browser can't record video — try Chrome or Edge"
          }
          className="flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download size={13} />
          Download video
        </button>

        {downloadUrl && (
          <a
            href={downloadUrl}
            download
            className="text-xs font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-200"
          >
            Save again
          </a>
        )}
      </div>

      <p className="text-center text-xs text-slate-500">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : board ? (
          <>
            {Math.round(board.duration)}s · {board.panel === "code" ? "code walkthrough" : board.panel === "diagram" ? "diagram" : "lesson plan"} ·{" "}
            {board.captions.length} captions ·{" "}
            {hasNarration ? `${board.languageLabel} narration` : "silent (voice unavailable)"}
          </>
        ) : (
          "Rendered from this turn's script, visuals and concept plan."
        )}
      </p>
    </div>
  );
}
