"use client";

import { useEffect, useState } from "react";
import { BrainCog } from "lucide-react";
import {
  AI_PROVIDERS,
  PROVIDER_ENV_VARS,
  PROVIDER_LABELS,
  TEACHER_MODELS,
  TEACHER_MODEL_LIST,
  type AiProvider,
  type ProvidersResponseBody,
  type TeacherModelId,
} from "@/lib/types";

export function ModelSelector({
  model,
  onModelChange,
  extendedThinking,
  onExtendedThinkingChange,
}: {
  model: TeacherModelId;
  onModelChange: (model: TeacherModelId) => void;
  extendedThinking: boolean;
  onExtendedThinkingChange: (enabled: boolean) => void;
}) {
  // Which providers actually have a key on the server. Until this resolves,
  // every option stays enabled so the control is never briefly unusable.
  const [configured, setConfigured] = useState<AiProvider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProvidersResponseBody | null) => {
        if (!cancelled && data) setConfigured(data.configured);
      })
      .catch(() => {
        // Leave everything selectable rather than locking the picker on a
        // transient failure — the teach route reports a missing key anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = TEACHER_MODELS[model];
  const thinkingSupported = selected.supportsThinking;
  const isConfigured = (provider: AiProvider) =>
    configured === null || configured.includes(provider);

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <select
        value={model}
        onChange={(e) => onModelChange(e.target.value as TeacherModelId)}
        title="Teaching model"
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400"
      >
        {AI_PROVIDERS.map((provider) => {
          const available = isConfigured(provider);
          return (
            <optgroup
              key={provider}
              label={
                available
                  ? PROVIDER_LABELS[provider]
                  : `${PROVIDER_LABELS[provider]} — set ${PROVIDER_ENV_VARS[provider]}`
              }
            >
              {TEACHER_MODEL_LIST.filter((entry) => entry.provider === provider).map(
                (entry) => (
                  <option
                    key={entry.id}
                    value={entry.id}
                    disabled={!available}
                    className="bg-slate-900"
                  >
                    {entry.label}
                  </option>
                ),
              )}
            </optgroup>
          );
        })}
      </select>

      <button
        type="button"
        role="switch"
        aria-checked={extendedThinking && thinkingSupported}
        disabled={!thinkingSupported}
        onClick={() => onExtendedThinkingChange(!extendedThinking)}
        title={
          thinkingSupported
            ? "Enable Extended Thinking"
            : `Extended Thinking isn't available on ${selected.label}`
        }
        className="flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <BrainCog size={14} className="text-slate-400" />
        <span className="text-slate-400">Extended Thinking</span>
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
            extendedThinking && thinkingSupported ? "bg-indigo-500" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              extendedThinking && thinkingSupported ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
      </button>
    </div>
  );
}
