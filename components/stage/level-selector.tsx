"use client";

import { GraduationCap } from "lucide-react";
import { LEARNER_LEVEL_OPTIONS, type LearnerLevel } from "@/lib/types";

/**
 * Section 6 of the brief lets the learner state their level. Making it a
 * control rather than something they have to remember to type is the
 * difference between personalisation that happens and personalisation that
 * happens if the student phrases their first message correctly.
 */
export function LevelSelector({
  learnerLevel,
  onLearnerLevelChange,
}: {
  learnerLevel: LearnerLevel;
  onLearnerLevelChange: (level: LearnerLevel) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <GraduationCap size={14} className="text-slate-400" />
      <select
        value={learnerLevel}
        onChange={(e) => onLearnerLevelChange(e.target.value as LearnerLevel)}
        title="Your level — changes how deeply everything is explained"
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400"
      >
        {LEARNER_LEVEL_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-900">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
