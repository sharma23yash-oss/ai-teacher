"use client";

import { useEffect, useState } from "react";
import { BrainCog } from "lucide-react";
import {
  MODEL_TIERS,
  MODEL_TIER_META,
  PROVIDER_LABELS,
  TEACHER_MODELS,
  TEACHER_MODEL_LIST,
  type AiProvider,
  type ModelTier,
  type ProvidersResponseBody,
  type TeacherModelId,
} from "@/lib/types";

/**
 * Three tiers instead of nine model names. Picking a tier selects the first
 * model in it whose provider has a key on the server (Gemini first, since it
 * is the only one that can read webcam frames). If that provider fails
 * mid-lesson, the teach route's failover still takes over.
 */
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
  // Which providers have a key on the server. Until this resolves every tier
  // stays enabled so the control is never briefly unusable.
  const [configured, setConfigured] = useState<AiProvider[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ProvidersResponseBody | null) => {
        if (!cancelled && data) setConfigured(data.configured);
      })
      .catch(() => {
        // Leave everything selectable; the teach route reports a missing key anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isConfigured = (provider: AiProvider) =>
    configured === null || configured.includes(provider);

  const modelsInTier = (tier: ModelTier) =>
    TEACHER_MODEL_LIST.filter((entry) => entry.tier === tier);

  const pickModelForTier = (tier: ModelTier): TeacherModelId | null =>
    modelsInTier(tier).find((entry) => isConfigured(entry.provider))?.id ?? null;

  const selected = TEACHER_MODELS[model];
  const thinkingSupported = selected.supportsThinking;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <div
        role="radiogroup"
        aria-label="Teaching model speed"
        className="flex gap-1 rounded-lg bg-white/5 p-1"
      >
        {MODEL_TIERS.map((tier) => {
          const target = pickModelForTier(tier);
          const isActive = selected.tier === tier;
          const providers = modelsInTier(tier)
            .map((entry) => `${PROVIDER_LABELS[entry.provider]}: ${entry.label}`)
            .join("\n");
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={!target}
              onClick={() => target && onModelChange(target)}
              title={`${MODEL_TIER_META[tier].hint}\n\nRuns on:\n${providers}`}
              className={`rounded-md px-3 py-1.5 font-medium transition focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 ${
                isActive ? "bg-indigo-500 text-white" : "text-slate-300 hover:text-white"
              }`}
            >
              {MODEL_TIER_META[tier].label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={extendedThinking && thinkingSupported}
        disabled={!thinkingSupported}
        onClick={() => onExtendedThinkingChange(!extendedThinking)}
        title={
          thinkingSupported
            ? "Let the model think longer before answering"
            : `Extended Thinking isn't available on the ${MODEL_TIER_META[selected.tier].label} tier`
        }
        className="flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <BrainCog size={14} className="text-slate-300" aria-hidden="true" />
        <span className="text-slate-300">Extended Thinking</span>
        <span
          aria-hidden="true"
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
