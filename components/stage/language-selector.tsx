"use client";

import { Languages } from "lucide-react";
import { LANGUAGE_META, LANGUAGE_OPTIONS, type Language } from "@/lib/types";

// Nineteen languages is too many for a flat list to be scannable, and the
// split people actually think in is "my language" versus "a foreign one" —
// so the groups come straight off LANGUAGE_META rather than being hand-listed.
const GROUPS = [
  { label: "Indian languages", group: "Indian" as const },
  { label: "International", group: "International" as const },
];

export function LanguageSelector({
  language,
  onLanguageChange,
}: {
  language: Language;
  onLanguageChange: (language: Language) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Languages size={14} className="text-slate-400" />
      <select
        value={language}
        onChange={(e) => onLanguageChange(e.target.value as Language)}
        title="Teaching language — switch any time and the lesson carries over"
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400"
      >
        {GROUPS.map(({ label, group }) => (
          <optgroup key={group} label={label} className="bg-slate-900">
            {LANGUAGE_OPTIONS.filter((option) => LANGUAGE_META[option.value].group === group).map(
              (option) => (
                <option key={option.value} value={option.value} className="bg-slate-900">
                  {option.label}
                </option>
              ),
            )}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
