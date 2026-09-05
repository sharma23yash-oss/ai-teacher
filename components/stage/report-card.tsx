"use client";

import { Award, CheckCircle2, TrendingUp, TriangleAlert } from "lucide-react";
import type { QuizReport } from "@/lib/types";

export function ReportCard({ report }: { report: QuizReport }) {
  const { scorePercent, masteredConcepts, weakConcepts, recommendation } = report;

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-2 text-indigo-400">
          <Award size={20} />
          <h3 className="text-xs font-semibold uppercase tracking-wider">
            Learning Report Card
          </h3>
        </div>

        <p className="mt-4 text-5xl font-bold text-slate-100">{scorePercent}%</p>
        <p className="text-sm text-slate-400">Final Score</p>

        <div className="mt-5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-emerald-400">
            <CheckCircle2 size={14} /> Mastered Concepts
          </p>
          <div className="flex flex-wrap gap-2">
            {masteredConcepts.length > 0 ? (
              masteredConcepts.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-500">None yet — keep practicing!</span>
            )}
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-amber-400">
            <TriangleAlert size={14} /> Needs Revision
          </p>
          <div className="flex flex-wrap gap-2">
            {weakConcepts.length > 0 ? (
              weakConcepts.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-300"
                >
                  {label}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-500">No weak areas — nice work!</span>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-start gap-2 rounded-lg bg-indigo-500/10 p-3 text-sm text-indigo-200">
          <TrendingUp size={16} className="mt-0.5 shrink-0" />
          <p>{recommendation}</p>
        </div>
      </div>
    </div>
  );
}
