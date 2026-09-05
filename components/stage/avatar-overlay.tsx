"use client";

import type { MouthFrame } from "@/lib/audio-engine";
import type { TeacherPersona, VoiceGender } from "@/lib/types";
import { AvatarFace, type AvatarState } from "./avatar-face";

// Compact picture-in-picture avatar shown while Code/Diagram/Quiz mode
// occupies the main Stage, so the teacher stays visually present — and keeps
// lip-syncing — while the student is looking at something else.
export function AvatarOverlay({
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
  return (
    <div
      className={`h-28 w-28 shrink-0 overflow-hidden rounded-2xl border shadow-lg backdrop-blur-sm transition-colors sm:h-32 sm:w-32 ${
        state === "talking"
          ? "border-indigo-400/60"
          : state === "listening"
            ? "border-emerald-400/50"
            : "border-white/15"
      }`}
    >
      <AvatarFace
        persona={persona}
        voiceGender={voiceGender}
        state={state}
        readMouthFrame={readMouthFrame}
        variant="pip"
        className="h-full w-full"
      />
    </div>
  );
}
