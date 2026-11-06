"use client";

import { useId, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import {
  FEEDBACK_COMMENT_MAX_CHARS,
  type FeedbackRating,
} from "@/lib/metrics/feedback";

const OPTIONS: { value: FeedbackRating; label: string; emoji: string }[] = [
  { value: "yes", label: "Yes", emoji: "👍" },
  { value: "partly", label: "Partly", emoji: "🤔" },
  { value: "no", label: "Not really", emoji: "👎" },
];

/**
 * Post-lesson check: "Did you understand this?" with an optional comment.
 * One tap is enough; the comment is there for anyone who wants to say more.
 */
export function FeedbackCard({
  onSubmit,
  onDismiss,
}: {
  onSubmit: (rating: FeedbackRating, comment: string) => void;
  onDismiss: () => void;
}) {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const headingId = useId();
  const commentId = useId();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!rating) return;
    onSubmit(rating, comment.trim());
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div
        role="status"
        className="mx-4 my-3 flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
      >
        Thanks! This helps us teach better.
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close"
          className="rounded p-1 text-emerald-700 hover:bg-emerald-100 focus-visible:outline-2 focus-visible:outline-emerald-600"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby={headingId}
      className="mx-4 my-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-slate-900">
          Did you understand this?
        </h3>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Skip feedback"
          className="rounded p-1 text-slate-600 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div role="radiogroup" aria-labelledby={headingId} className="mt-2 flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={rating === option.value}
            onClick={() => setRating(option.value)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-indigo-600 ${
              rating === option.value
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-slate-300 bg-white text-slate-800 hover:border-indigo-400"
            }`}
          >
            <span aria-hidden="true">{option.emoji}</span>
            {option.label}
          </button>
        ))}
      </div>

      {rating && (
        <div className="mt-3">
          <label htmlFor={commentId} className="text-xs font-medium text-slate-700">
            {rating === "yes"
              ? "What worked well? (optional)"
              : "What was confusing? (optional)"}
          </label>
          <textarea
            id={commentId}
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, FEEDBACK_COMMENT_MAX_CHARS))}
            rows={2}
            className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-slate-600">Anonymous. Don&apos;t include personal details.</span>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
