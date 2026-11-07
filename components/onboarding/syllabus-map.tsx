import type { ExamPreset } from "@/lib/types";
import { chapterWeight, hasWeightage, syllabusFor, weightageLabel } from "@/lib/exams/syllabi";

const STATUS_TEXT = {
  verified: { label: "Verified", className: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" },
  draft: { label: "Draft: verify before relying on it", className: "border-amber-400/50 bg-amber-500/15 text-amber-200" },
  placeholder: { label: "Placeholder: weightage not filled in yet", className: "border-slate-400/40 bg-white/5 text-slate-300" },
} as const;

/** Collapsible chapter list with weightage for the selected exam preset. */
export function SyllabusMap({ preset }: { preset: ExamPreset }) {
  const syllabus = syllabusFor(preset);
  if (!syllabus) return null;
  const status = STATUS_TEXT[syllabus.status];
  const weighted = hasWeightage(syllabus);
  const maxWeight = Math.max(1, ...syllabus.chapters.map((c) => chapterWeight(c) ?? 0));

  return (
    <details className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium text-slate-100">
        Syllabus map · {syllabus.chapters.length} chapters
        <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}>
          {status.label}
        </span>
      </summary>
      <p className="mt-2 text-xs text-slate-400">{syllabus.name}</p>
      <ol className="mt-2 space-y-1.5">
        {syllabus.chapters.map((chapter) => {
          const label = weightageLabel(chapter);
          const weight = chapterWeight(chapter);
          return (
            <li key={chapter.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
              <span className="text-slate-200">{chapter.title}</span>
              <span className="text-xs tabular-nums text-slate-300">{label ?? "—"}</span>
              {weighted && (
                <div className="col-span-2 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                  <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${((weight ?? 0) / maxWeight) * 100}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!weighted && (
        <p className="mt-2 text-xs text-slate-400">
          Weightage isn&apos;t filled in yet, so practice spreads evenly across chapters.
        </p>
      )}
    </details>
  );
}
