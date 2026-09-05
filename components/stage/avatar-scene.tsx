"use client";

import type { MouthFrame } from "@/lib/audio-engine";
import { resolveAvatarTheme } from "@/lib/avatar-theme";
import type { TeacherPersona, VoiceGender } from "@/lib/types";
import { AvatarFace, type AvatarState } from "./avatar-face";

const STATE_LABEL: Record<AvatarState, string> = {
  idle: "Ready",
  listening: "Listening",
  talking: "Speaking",
};

const STATE_TONE: Record<AvatarState, string> = {
  idle: "bg-white/10 text-slate-300",
  listening: "bg-emerald-500/15 text-emerald-300",
  talking: "bg-indigo-500/20 text-indigo-200",
};

/**
 * Full-size educator portrait for the Stage's avatar mode. The animated face
 * replaces the previous placeholder 3D primitive — it lip-syncs to the live
 * audio and carries per-persona styling.
 */
export function AvatarScene({
  persona,
  voiceGender,
  state,
  readMouthFrame,
}: {
  persona: TeacherPersona;
  voiceGender: VoiceGender;
  state: AvatarState;
  readMouthFrame: () => MouthFrame;
}) {
  const theme = resolveAvatarTheme(persona, voiceGender);

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <div className="relative flex h-full max-h-[560px] w-full max-w-[520px] items-center justify-center">
        {state === "listening" && (
          <span
            className="avatar-listening-ring pointer-events-none absolute h-[70%] w-[70%] rounded-full border-2 border-emerald-400/50"
            aria-hidden="true"
          />
        )}
        <AvatarFace
          persona={persona}
          voiceGender={voiceGender}
          state={state}
          readMouthFrame={readMouthFrame}
          variant="full"
          className="h-full w-full object-contain"
        />
      </div>

      <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
        <span className="rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur-sm">
          {theme.title}
        </span>
        <span
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium backdrop-blur-sm ${STATE_TONE[state]}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              state === "talking"
                ? "animate-pulse bg-indigo-300"
                : state === "listening"
                  ? "animate-pulse bg-emerald-400"
                  : "bg-slate-400"
            }`}
          />
          {STATE_LABEL[state]}
        </span>
      </div>
    </div>
  );
}
