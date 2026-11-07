import { BookOpen } from "lucide-react";
import type { Citation } from "@/lib/course/schemas";

export function CitationChip({ citation }: { citation?: Citation }) {
  if (!citation) return null;
  const label = [citation.locator, citation.heading].filter(Boolean).join(" · ");
  return (
    <span
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
      title={`From your notes: ${label}`}
    >
      <BookOpen size={11} aria-hidden="true" className="shrink-0" />
      <span className="sr-only">Source: </span>
      <span className="truncate">{label}</span>
    </span>
  );
}
