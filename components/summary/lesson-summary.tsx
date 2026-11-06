"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Flame, Share2, Target, X } from "lucide-react";
import type { LessonSummary } from "@/lib/learning/summary";
import { canvasToPngFile, drawSummaryImage } from "./summary-image";

function fileNameFor(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `ai-teacher-${slug || "lesson"}-summary.png`;
}

/**
 * End-of-lesson summary: what was learned, weak spots, the next step and the
 * streak, with a shareable image. A native <dialog> opened with showModal()
 * gives focus trapping, Escape to close and an inert background for free.
 */
export function LessonSummaryDialog({
  summary,
  open,
  onClose,
}: {
  summary: LessonSummary;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    try {
      const probe = new File([""], "probe.png", { type: "image/png" });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- feature detection after mount
      setCanShareFiles(typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, [open]);

  async function makeFile() {
    const canvas = drawSummaryImage(summary, window.location.host);
    return canvasToPngFile(canvas, fileNameFor(summary.topic));
  }

  async function handleDownload() {
    const file = await makeFile();
    if (!file) {
      setStatus("Couldn't create the image in this browser.");
      return;
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Image saved.");
  }

  async function handleShare() {
    const file = await makeFile();
    if (!file) {
      setStatus("Couldn't create the image in this browser.");
      return;
    }
    try {
      await navigator.share({
        files: [file],
        title: `I learned ${summary.topic}`,
        text: `I just finished a lesson on ${summary.topic} with AI Teacher.`,
      });
      setStatus(null);
    } catch (error) {
      // AbortError means the student closed the share sheet; not a failure.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setStatus("Sharing didn't work here. Try Download instead.");
      }
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="summary-title"
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-slate-900 p-0 text-slate-100 shadow-2xl backdrop:bg-black/70"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300">Lesson summary</p>
            <h2 id="summary-title" className="mt-1 text-xl font-semibold text-white">
              {summary.topic}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close summary"
            className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <section aria-labelledby="learned-heading" className="mt-5">
          <h3 id="learned-heading" className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
            <CheckCircle2 size={16} aria-hidden="true" /> What you learned
          </h3>
          {summary.learned.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-slate-200">
              {summary.learned.map((c) => (
                <li key={c.label}>
                  {c.label}
                  {c.percent !== null && <span className="text-slate-400"> · {c.percent}% mastery</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-400">Nothing at full strength yet. That&apos;s normal: it takes a few rounds.</p>
          )}
        </section>

        <section aria-labelledby="weak-heading" className="mt-4">
          <h3 id="weak-heading" className="flex items-center gap-2 text-sm font-semibold text-amber-300">
            <Target size={16} aria-hidden="true" /> Weak spots
          </h3>
          {summary.weak.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm text-slate-200">
              {summary.weak.map((c) => (
                <li key={c.label}>
                  {c.label}
                  {c.percent !== null && <span className="text-slate-400"> · {c.percent}% mastery</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-slate-400">None this time.</p>
          )}
        </section>

        <section aria-labelledby="next-heading" className="mt-4 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-3">
          <h3 id="next-heading" className="text-sm font-semibold text-indigo-200">Next step</h3>
          <p className="mt-1 text-sm text-slate-100">{summary.nextStep}</p>
        </section>

        {summary.streak > 0 && (
          <p className="mt-4 flex items-center gap-2 text-sm font-medium text-orange-300">
            <Flame size={16} aria-hidden="true" /> {summary.streak}-day learning streak
          </p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            <Download size={15} aria-hidden="true" /> Download image
          </button>
          {canShareFiles && (
            <button
              type="button"
              onClick={handleShare}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
            >
              <Share2 size={15} aria-hidden="true" /> Share
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
          >
            Back to lesson
          </button>
        </div>
        <p role="status" className="mt-2 min-h-5 text-xs text-slate-400">
          {status}
        </p>
        <p className="text-xs text-slate-500">The image shows only the topic, concepts and streak. No name or personal data.</p>
      </div>
    </dialog>
  );
}
