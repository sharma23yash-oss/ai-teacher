"use client";

import { Languages } from "lucide-react";
import { LANGUAGE_OPTIONS, type Language } from "@/lib/types";

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
        title="Teaching Language"
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400"
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-900">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
