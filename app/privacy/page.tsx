import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { FEEDBACK_URL, SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What AI Teacher stores, what it sends to AI providers, and what it never collects. Written for students of every age.",
  alternates: { canonical: "/privacy" },
};

const SECTIONS: { title: string; body: React.ReactNode }[] = [
  {
    title: "The short version",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>No account, no sign-up, no login.</li>
        <li>We never ask for your name, email, phone number, age, school or location.</li>
        <li>Your progress is saved only in your own browser.</li>
        <li>We count how the app is used in anonymous totals, with no cookies and no tracking.</li>
        <li>AI Teacher is safe for students of any age to use without sharing personal details.</li>
      </ul>
    ),
  },
  {
    title: "Saved on your device",
    body: (
      <p>
        Your lesson history, quiz scores, the concepts you have mastered and your settings are kept
        in your browser&apos;s local storage. They never leave your device unless you send them in a
        lesson. Use <span className="font-medium text-white">Progress → Reset</span> or clear your
        browser data to delete them.
      </p>
    ),
  },
  {
    title: "Sent to the AI model",
    body: (
      <p>
        To write each reply, your messages, the lesson so far and any passages from a file you
        uploaded are sent to one of the AI providers we use (Google Gemini, Groq or Cohere).
        During a video call, a single camera frame may be sent to Google Gemini so the teacher can
        react to your gestures. Please don&apos;t type personal details into a lesson. Gestures are
        recognised on your device; video is never recorded or stored by us.
      </p>
    ),
  },
  {
    title: "Files you upload",
    body: (
      <p>
        Uploaded notes and PDFs are read and indexed in temporary server memory so the teacher can
        quote them. They are not saved to disk or a database, and they disappear when the server
        restarts.
      </p>
    ),
  },
  {
    title: "Anonymous usage counts",
    body: (
      <p>
        To show that the app helps people learn, we add events to running totals: a lesson started
        or finished, a quiz score, the language chosen, how long a visit lasted, and your answer to
        &ldquo;Did you understand this?&rdquo;. These totals contain no name, account, IP address,
        cookie or lesson content. If you write an optional feedback comment, it is stored as you
        typed it, so please leave out personal details.
      </p>
    ),
  },
  {
    title: "Children and young learners",
    body: (
      <p>
        Many of our learners are school students. That is why the app works without any personal
        information at all. If we ever need to tell visits apart (for example, to count how many
        learners come back after a week), we will use only a random anonymous ID created in the
        browser, never a name or contact detail, and we will update this page first.
      </p>
    ),
  },
  {
    title: "Questions or requests",
    body: (
      <p>
        Use the{" "}
        <a
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-200"
        >
          feedback link
        </a>{" "}
        to ask a question or ask us to remove a feedback comment.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-slate-950 font-sans text-slate-100">
      <header className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-md text-sm font-semibold hover:text-indigo-200"
        >
          <GraduationCap size={22} className="text-indigo-400" aria-hidden="true" />
          AI Teacher
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        <h1 className="text-3xl font-semibold text-white">Privacy</h1>
        <p className="mt-2 text-sm text-slate-400">Last updated 6 November 2026</p>
        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-slate-300">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="mb-2 text-lg font-semibold text-white">{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
