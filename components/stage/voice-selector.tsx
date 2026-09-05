"use client";

import { AudioLines } from "lucide-react";
import {
  VOICE_GENDER_OPTIONS,
  type TeacherPersona,
  type VoiceGender,
} from "@/lib/types";

// The three character personas are written and voiced male, so the switcher is
// only meaningful for the neutral Standard Educator — showing a disabled
// control for the others explains why rather than silently ignoring the pick.
export function VoiceSelector({
  persona,
  voiceGender,
  onVoiceGenderChange,
}: {
  persona: TeacherPersona;
  voiceGender: VoiceGender;
  onVoiceGenderChange: (voiceGender: VoiceGender) => void;
}) {
  const isLocked = persona !== "standard";

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <AudioLines size={14} className="text-slate-400" />
      <select
        value={isLocked ? "male" : voiceGender}
        onChange={(e) => onVoiceGenderChange(e.target.value as VoiceGender)}
        disabled={isLocked}
        title={
          isLocked
            ? "This persona is written for a male voice"
            : "Teacher voice — also sets the avatar"
        }
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {VOICE_GENDER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-900">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
