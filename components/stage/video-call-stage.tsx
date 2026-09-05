"use client";

import { Loader2, ScanFace, TriangleAlert, VideoOff } from "lucide-react";
import type { MouthFrame } from "@/lib/audio-engine";
import type { GestureEngineStatus, HeadPose } from "@/lib/use-gesture-recognition";
import {
  GESTURE_SIGNALS,
  GESTURE_SIGNAL_META,
  type GestureSignal,
  type TeacherPersona,
  type VideoRefCallback,
  type VoiceGender,
} from "@/lib/types";
import { AvatarFace, type AvatarState } from "./avatar-face";

export interface VideoCallStageProps {
  videoRef: VideoRefCallback;
  isCallActive: boolean;
  cameraError: string | null;
  persona: TeacherPersona;
  voiceGender: VoiceGender;
  avatarState: AvatarState;
  readMouthFrame: () => MouthFrame;
  engineStatus: GestureEngineStatus;
  engineError: string | null;
  isTracking: boolean;
  rawGesture: string | null;
  headPose: HeadPose | null;
  lastSignal: GestureSignal | null;
  lastSignalId: number;
}

const RAW_GESTURE_TO_SIGNAL: Record<string, GestureSignal> = {
  Thumb_Up: "understood",
  Thumb_Down: "not_understood",
};

function StatusPill({
  engineStatus,
  engineError,
  isTracking,
}: {
  engineStatus: GestureEngineStatus;
  engineError: string | null;
  isTracking: boolean;
}) {
  if (engineStatus === "loading") {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-slate-300 backdrop-blur-sm">
        <Loader2 size={12} className="animate-spin" />
        Loading gesture models…
      </span>
    );
  }
  if (engineStatus === "error") {
    return (
      <span
        className="flex max-w-[22rem] items-center gap-1.5 truncate rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-amber-300 backdrop-blur-sm"
        title={engineError ?? undefined}
      >
        <TriangleAlert size={12} />
        Gestures unavailable — voice and chat still work
      </span>
    );
  }
  if (engineStatus === "ready") {
    return (
      <span
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm ${
          isTracking ? "bg-emerald-500/20 text-emerald-300" : "bg-black/60 text-slate-400"
        }`}
      >
        <ScanFace size={12} />
        {isTracking ? "Tracking you" : "Step into frame"}
      </span>
    );
  }
  return null;
}

/**
 * Full-stage live video call. The student's camera fills the stage, the
 * animated teacher sits in the corner, and every recognised non-verbal signal
 * is shown as it fires so the student can see the app understood them.
 */
export function VideoCallStage({
  videoRef,
  isCallActive,
  cameraError,
  persona,
  voiceGender,
  avatarState,
  readMouthFrame,
  engineStatus,
  engineError,
  isTracking,
  rawGesture,
  headPose,
  lastSignal,
  lastSignalId,
}: VideoCallStageProps) {
  if (!isCallActive) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
        <VideoOff size={28} className="text-slate-600" />
        <p className="text-sm text-slate-400">
          Start a video call to teach face to face.
        </p>
        <p className="max-w-md text-xs leading-relaxed text-slate-500">
          Once the camera is on, a thumbs up moves the lesson forward, a thumbs down makes
          the teacher re-explain in simpler terms, a head shake pauses for questions, and a
          nod advances to the next idea.
        </p>
        {cameraError && <p className="text-xs text-red-400">{cameraError}</p>}
      </div>
    );
  }

  const activeSignal: GestureSignal | null = rawGesture
    ? (RAW_GESTURE_TO_SIGNAL[rawGesture] ?? null)
    : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full -scale-x-100 object-cover"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="flex flex-col items-start gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-red-400 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            LIVE
          </span>
          <StatusPill
            engineStatus={engineStatus}
            engineError={engineError}
            isTracking={isTracking}
          />
        </div>

        <div className="h-28 w-28 overflow-hidden rounded-2xl border border-white/20 shadow-xl sm:h-36 sm:w-36">
          <AvatarFace
            persona={persona}
            voiceGender={voiceGender}
            state={avatarState}
            readMouthFrame={readMouthFrame}
            variant="pip"
            className="h-full w-full"
          />
        </div>
      </div>

      {lastSignal && (
        <div
          key={`${lastSignal}-${lastSignalId}`}
          className="gesture-pop pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <div className="flex items-center gap-3 rounded-2xl bg-black/70 px-5 py-3 backdrop-blur-md">
            <span className="text-3xl">{GESTURE_SIGNAL_META[lastSignal].glyph}</span>
            <div className="text-left">
              <p className={`text-sm font-semibold ${GESTURE_SIGNAL_META[lastSignal].tone}`}>
                {GESTURE_SIGNAL_META[lastSignal].meaning}
              </p>
              <p className="text-xs text-slate-400">
                {GESTURE_SIGNAL_META[lastSignal].label} detected
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-4">
        {GESTURE_SIGNALS.map((signal) => {
          const meta = GESTURE_SIGNAL_META[signal];
          const isActive = activeSignal === signal || lastSignal === signal;
          return (
            <span
              key={signal}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition ${
                isActive
                  ? `bg-white/15 ${meta.tone}`
                  : "bg-black/50 text-slate-400"
              }`}
            >
              <span className="text-sm">{meta.glyph}</span>
              {meta.meaning}
            </span>
          );
        })}
        {headPose && engineStatus === "ready" && (
          <span className="rounded-full bg-black/50 px-3 py-1.5 font-mono text-[10px] text-slate-500">
            yaw {headPose.yaw.toFixed(0)}° · pitch {headPose.pitch.toFixed(0)}°
          </span>
        )}
      </div>
    </div>
  );
}
