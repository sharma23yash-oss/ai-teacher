import Link from "next/link";

// Shared by the landing page (a client component) and server pages such as
// /privacy, so it lives outside any "use client" module.
export const FEEDBACK_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_URL || "https://github.com/sharma23yash-oss/ai-teacher/issues/new";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 text-sm text-slate-300 sm:px-6 md:grid-cols-3">
        <div>
          <h2 className="font-semibold text-white">Privacy</h2>
          <p className="mt-1">
            No account, and we never ask for your name, email, phone or age, so it is safe for
            students of any age. Your progress stays in this browser. Your questions go to the AI
            model to write each reply. We only count anonymous totals, with no cookies or lesson
            content.
          </p>
          <Link
            href="/privacy"
            className="mt-2 inline-block font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-200"
          >
            Read the full privacy note
          </Link>
        </div>
        <div>
          <h2 className="font-semibold text-white">Free to use</h2>
          <p className="mt-1">
            AI Teacher is free. It runs on the free tiers of Google Gemini, Groq and Cohere, so
            replies can slow down at busy times, and there is a fair-use limit per minute.
          </p>
        </div>
        <div>
          <h2 className="font-semibold text-white">Feedback</h2>
          <p className="mt-1">Something confusing, broken or missing? We read every note.</p>
          <a
            href={FEEDBACK_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-200 focus-visible:outline-2 focus-visible:outline-indigo-400"
          >
            Send feedback
          </a>
        </div>
      </div>
    </footer>
  );
}
