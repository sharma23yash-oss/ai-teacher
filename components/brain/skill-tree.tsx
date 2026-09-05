import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Lock,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import type { ConceptNode, ConceptStatus } from "@/lib/types";

const STATUS_STYLES: Record<
  ConceptStatus,
  { icon: LucideIcon; className: string }
> = {
  completed: {
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  current: {
    icon: Circle,
    className:
      "border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-100",
  },
  misconception: {
    icon: AlertTriangle,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  locked: {
    icon: Lock,
    className: "border-slate-200 bg-slate-50 text-slate-400",
  },
};

export function SkillTree({
  concepts,
  celebratingConceptId,
}: {
  concepts: ConceptNode[];
  /** Concept id to flash a mastery-ping on right now, or null for none —
   * set for a few seconds after Feynman Mode detects the mastery marker. */
  celebratingConceptId: string | null;
}) {
  return (
    <div className="px-4 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Concept Skill Tree
      </h3>
      {concepts.length === 0 && (
        <p className="text-sm text-slate-400">
          Ask a question to generate a syllabus for your topic.
        </p>
      )}
      <ol className="space-y-2">
        {concepts.map((concept, i) => {
          const { icon: Icon, className } = STATUS_STYLES[concept.status];
          const isCelebrating = concept.id === celebratingConceptId;
          return (
            <li key={concept.id} className="flex items-center gap-3">
              <div
                className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all ${className} ${
                  isCelebrating ? "ring-4 ring-emerald-300" : ""
                }`}
              >
                <Icon size={15} />
                {isCelebrating && (
                  <span className="gesture-pop absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
                    <PartyPopper size={11} />
                  </span>
                )}
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    concept.status === "locked"
                      ? "text-slate-400"
                      : "text-slate-800"
                  }`}
                >
                  {i + 1}. {concept.label}
                </p>
                {concept.status === "misconception" && (
                  <p className="text-xs text-amber-600">Needs scaffolding</p>
                )}
                {isCelebrating && (
                  <p className="gesture-pop text-xs font-medium text-emerald-600">
                    Mastered! 🎉
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
