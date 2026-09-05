"use client";

import { Timer } from "lucide-react";
import { TIME_BUDGET_OPTIONS, type TimeBudget } from "@/lib/types";

export function TimeBudgetSelector({
  timeBudget,
  onTimeBudgetChange,
}: {
  timeBudget: TimeBudget;
  onTimeBudgetChange: (timeBudget: TimeBudget) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Timer size={14} className="text-slate-400" />
      <select
        value={timeBudget}
        onChange={(e) => onTimeBudgetChange(e.target.value as TimeBudget)}
        title="Time Budget"
        className="rounded-md border border-white/15 bg-white/5 px-2 py-1.5 text-slate-300 outline-none focus:border-indigo-400"
      >
        {TIME_BUDGET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value} className="bg-slate-900">
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
