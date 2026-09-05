"use client";

import { BookOpen, Flame, History, Trash2, TrendingUp } from "lucide-react";
import { averageScore } from "@/lib/learner-profile";
import type { LearnerProfileRecord } from "@/lib/types";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/**
 * The learner profile, made visible.
 *
 * Section 14 asks the system to keep topics studied, progress, scores, weak
 * and strong concepts and learning history — and it is worth showing the
 * student, not just feeding to the model: seeing "you've struggled with
 * range() twice" is itself the feedback that makes them go back to it.
 */
export function ProgressPanel({
  profile,
  onReset,
}: {
  profile: LearnerProfileRecord;
  onReset: () => void;
}) {
  const hasHistory = profile.topics.length > 0;

  if (!hasHistory) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <BookOpen size={22} className="text-slate-300" />
        <p className="text-sm font-medium text-slate-600">No learning history yet</p>
        <p className="max-w-xs text-xs text-slate-400">
          Once you finish a lesson or a quiz, your topics, scores and weak concepts are saved on
          this device and carried into your next session.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <TrendingUp size={13} /> Your progress
        </p>
        <button
          onClick={onReset}
          title="Delete everything saved about your learning on this device"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={12} /> Reset
        </button>
      </div>

      <div className="flex flex-col gap-2.5">
        {profile.topics.slice(0, 5).map((record) => {
          const average = averageScore(record);
          return (
            <div
              key={record.topic}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-snug text-slate-800">{record.topic}</p>
                {average !== null && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      average >= 70
                        ? "bg-emerald-50 text-emerald-700"
                        : average >= 40
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                    }`}
                  >
                    {average}%
                  </span>
                )}
              </div>

              <p className="mt-1 text-[11px] text-slate-400">
                {record.sessions} session{record.sessions === 1 ? "" : "s"} ·{" "}
                {relativeTime(record.lastStudiedAt)}
              </p>

              {record.conceptsCompleted.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {record.conceptsCompleted.slice(0, 4).map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}

              {record.conceptsWeak.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <Flame size={11} className="text-amber-500" />
                  {record.conceptsWeak.slice(0, 4).map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {profile.history.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <History size={13} /> Recent activity
          </p>
          <ul className="flex flex-col gap-1">
            {profile.history.slice(0, 6).map((entry, i) => (
              <li
                key={`${entry.at}-${i}`}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="truncate text-slate-600">{entry.detail}</span>
                <span className="shrink-0 text-[11px] text-slate-400">
                  {relativeTime(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
