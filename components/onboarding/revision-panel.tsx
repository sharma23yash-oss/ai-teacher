import { Flame, RefreshCw } from "lucide-react";
import { MINUTES_PER_REVIEW } from "@/lib/learning/spaced-repetition";

export interface RevisionItem {
  key: string;
  label: string;
  topic: string;
}

/**
 * Today's spaced-repetition revision on the landing page: the concepts due,
 * how long it takes, and the streak. Hidden for a first-time visitor.
 */
export function RevisionPanel({
  items,
  streak,
  onStart,
}: {
  items: RevisionItem[];
  streak: number;
  onStart: () => void;
}) {
  if (items.length === 0 && streak === 0) return null;
  const minutes = items.length * MINUTES_PER_REVIEW;

  return (
    <section
      aria-labelledby="revision-heading"
      className="mx-auto mt-6 max-w-3xl rounded-2xl border border-emerald-400/30 bg-emerald-500/[0.07] p-4 text-left"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="revision-heading" className="flex items-center gap-2 text-base font-semibold text-white">
          <RefreshCw size={16} className="text-emerald-300" aria-hidden="true" />
          {items.length > 0 ? "Today's 10-minute revision" : "No revision due today"}
        </h2>
        {streak > 0 && (
          <span className="flex items-center gap-1 text-sm font-medium text-orange-300">
            <Flame size={15} aria-hidden="true" /> {streak}-day streak
          </span>
        )}
      </div>
      {items.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-slate-300">
            {items.length} concept{items.length === 1 ? "" : "s"} due, about {minutes} minutes. Reviewing just before you
            forget is what makes it stick.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {items.map((item) => (
              <li
                key={item.key}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200"
                title={item.topic}
              >
                {item.label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onStart}
            className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            Start revision
          </button>
        </>
      ) : (
        <p className="mt-1 text-sm text-slate-300">You&apos;re up to date. Learn something new to keep your streak going.</p>
      )}
    </section>
  );
}
