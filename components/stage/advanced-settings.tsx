"use client";

import { useId, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import {
  LANGUAGE_META,
  MODEL_TIER_META,
  PERSONA_OPTIONS,
  TEACHER_MODELS,
  TIME_BUDGET_OPTIONS,
  type Language,
  type LearnerLevel,
  type TeacherModelId,
  type TeacherPersona,
  type TimeBudget,
  type VoiceGender,
} from "@/lib/types";
import { ModelSelector } from "./model-selector";
import { PersonaSelector } from "./persona-selector";
import { VoiceSelector } from "./voice-selector";
import { LanguageSelector } from "./language-selector";
import { LevelSelector } from "./level-selector";
import { TimeBudgetSelector } from "./time-budget-selector";

/** Every lesson setting and its setter, passed around as one bundle. */
export interface LessonSettingsControls {
  model: TeacherModelId;
  onModelChange: (model: TeacherModelId) => void;
  extendedThinking: boolean;
  onExtendedThinkingChange: (enabled: boolean) => void;
  persona: TeacherPersona;
  onPersonaChange: (persona: TeacherPersona) => void;
  voiceGender: VoiceGender;
  onVoiceGenderChange: (voiceGender: VoiceGender) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  learnerLevel: LearnerLevel;
  onLearnerLevelChange: (level: LearnerLevel) => void;
  timeBudget: TimeBudget;
  onTimeBudgetChange: (timeBudget: TimeBudget) => void;
}

/** "Balanced · Standard Educator · English · 20 min" */
export function summarizeSettings(settings: LessonSettingsControls): string {
  const persona = PERSONA_OPTIONS.find((o) => o.value === settings.persona)?.label ?? "";
  const budget = TIME_BUDGET_OPTIONS.find((o) => o.value === settings.timeBudget)?.label ?? "";
  return [
    MODEL_TIER_META[TEACHER_MODELS[settings.model].tier].label,
    persona,
    LANGUAGE_META[settings.language]?.label ?? settings.language,
    budget.replace(/-Minute.*/, " min"),
  ].join(" · ");
}

/**
 * The "Advanced" drawer: a disclosure button that reveals every lesson
 * setting. Most students never need it — the defaults (Balanced, Standard
 * Educator, 20-minute lesson) are chosen to work without touching anything.
 */
export function AdvancedSettings({
  settings,
  defaultOpen = false,
}: {
  settings: LessonSettingsControls;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex max-w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-400"
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span className="font-medium">Advanced</span>
        <span className="truncate text-slate-400">{summarizeSettings(settings)}</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="mt-2 grid gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <fieldset className="sm:col-span-2 lg:col-span-3">
            <legend className="mb-1.5 text-xs font-medium text-slate-300">Model</legend>
            <ModelSelector
              model={settings.model}
              onModelChange={settings.onModelChange}
              extendedThinking={settings.extendedThinking}
              onExtendedThinkingChange={settings.onExtendedThinkingChange}
            />
          </fieldset>
          <Field label="Teacher persona">
            <PersonaSelector persona={settings.persona} onPersonaChange={settings.onPersonaChange} />
          </Field>
          <Field label="Voice">
            <VoiceSelector
              persona={settings.persona}
              voiceGender={settings.voiceGender}
              onVoiceGenderChange={settings.onVoiceGenderChange}
            />
          </Field>
          <Field label="Language">
            <LanguageSelector
              language={settings.language}
              onLanguageChange={settings.onLanguageChange}
            />
          </Field>
          <Field label="Your level">
            <LevelSelector
              learnerLevel={settings.learnerLevel}
              onLearnerLevelChange={settings.onLearnerLevelChange}
            />
          </Field>
          <Field label="Lesson length">
            <TimeBudgetSelector
              timeBudget={settings.timeBudget}
              onTimeBudgetChange={settings.onTimeBudgetChange}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// Wrapping the selector's <select> in a <label> gives it an accessible name
// without each selector component needing to know its own label text.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}
