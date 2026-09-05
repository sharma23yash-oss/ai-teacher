"use client";

import { useState } from "react";
import { ChevronDown, FileSearch } from "lucide-react";
import type { RetrievedChunk } from "@/lib/types";

/**
 * Shows which passages of the uploaded document the last answer was actually
 * built from.
 *
 * This is the part of a RAG system that is usually invisible, and it is the
 * part a student most needs: an answer they can trace back to a place in
 * their own notes is one they can check, and one they can revise from. It
 * also makes the honest case visible — when nothing was retrieved, nothing is
 * claimed.
 */
export function GroundingTrace({
  chunks,
  documentName,
}: {
  chunks: RetrievedChunk[];
  documentName: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!documentName || chunks.length === 0) return null;

  return (
    <div className="border-b border-slate-200 bg-indigo-50/40">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-5 py-2 text-left text-xs text-indigo-800 transition hover:bg-indigo-50"
      >
        <FileSearch size={13} className="shrink-0" />
        <span className="flex-1 truncate">
          Answered from <span className="font-medium">{documentName}</span> — {chunks.length}{" "}
          passage{chunks.length === 1 ? "" : "s"}
        </span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="max-h-52 overflow-y-auto px-5 pb-3">
          <ul className="flex flex-col gap-2">
            {chunks.map((chunk) => (
              <li key={chunk.id} className="rounded-lg border border-indigo-100 bg-white p-2.5">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                    {chunk.heading ?? `Passage ${chunk.index}`}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">
                    {chunk.score.toFixed(2)}
                  </span>
                </div>
                <p className="line-clamp-4 text-[11px] leading-relaxed text-slate-600">
                  {chunk.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
