"use client";

import { Drama } from "lucide-react";
import { PERSONA_OPTIONS, type TeacherPersona } from "@/lib/types";

export function PersonaSelector({
  persona,
  onPersonaChange,
}: {
  persona: TeacherPersona;
  onPersonaChange: (persona: TeacherPersona) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Drama size={14} className="text-slate-400" />
      <select
        value={persona}
        onChange={(e) => onPersonaChange(e.target.value as TeacherPersona)}
        title="Teacher Persona"
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400"
      >
        {PERSONA_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-900">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
