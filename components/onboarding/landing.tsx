"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowRight,
  FileText,
  GraduationCap,
  Loader2,
  MessageCircleQuestion,
  Paperclip,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import {
  EXAM_PRESETS,
  EXAM_PRESET_META,
  LANGUAGE_META,
  type ExamPreset,
  type Language,
} from "@/lib/types";
import { AdvancedSettings, type LessonSettingsControls } from "../stage/advanced-settings";

export const FEEDBACK_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_URL || "https://github.com/sharma23yash-oss/ai-teacher/issues/new";

const UPLOAD_ACCEPT = ".pdf,.txt,.md,.docx,.pptx";

interface SampleLesson {
  title: string;
  prompt: string;
  language: Language;
  tag: string;
}

const SAMPLE_LESSONS: SampleLesson[] = [
  {
    title: "How UPI moves money in two seconds",
    prompt: "Explain how a UPI payment travels from my phone to the shop's bank account",
    language: "hinglish",
    tag: "Hinglish · Tech",
  },
  {
    title: "Ohm's Law with everyday examples",
    prompt: "Teach me Ohm's Law with simple examples from things at home",
    language: "english",
    tag: "English · Physics",
  },
  {
    title: "Photosynthesis, in Hindi",
    prompt: "Explain photosynthesis step by step",
    language: "hindi",
    tag: "हिन्दी · Biology",
  },
];

const STEPS = [
  {
    icon: Sparkles,
    title: "Tell it what to learn",
    body: "Type any topic, or attach your notes or a textbook PDF. It plans a short lesson around your level.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Answer its questions",
    body: "Instead of lecturing, the teacher asks you questions, draws diagrams and talks you through each idea out loud.",
  },
  {
    icon: Target,
    title: "Quiz and fix the gaps",
    body: "A quick quiz checks what stuck. Anything you missed is taught again from a different angle.",
  },
];

export function Landing({
  settings,
  examPreset,
  onExamPresetChange,
  uploadedFileName,
  isUploading,
  uploadError,
  onUpload,
  onClearUpload,
  onStart,
}: {
  settings: LessonSettingsControls;
  examPreset: ExamPreset | null;
  onExamPresetChange: (preset: ExamPreset | null) => void;
  uploadedFileName: string | null;
  isUploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onClearUpload: () => void;
  /** Starts the lesson. `language` overrides the current setting for this first turn. */
  onStart: (prompt: string, language?: Language) => void;
}) {
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exam = examPreset ? EXAM_PRESET_META[examPreset] : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isUploading) return;
    onStart(prompt);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter starts the lesson; Shift+Enter adds a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  const quickLanguages: Language[] = ["english", "hinglish"];
  if (!quickLanguages.includes(settings.language)) quickLanguages.push(settings.language);

  return (
    <div className="min-h-dvh bg-slate-950 font-sans text-slate-100">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-4 sm:px-6">
        <GraduationCap size={22} className="text-indigo-400" aria-hidden="true" />
        <span className="text-sm font-semibold">AI Teacher</span>
      </header>

      <main>
        {/* Hero + prompt */}
        <section className="mx-auto max-w-3xl px-4 pb-12 pt-8 text-center sm:px-6 sm:pt-14">
          <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            Learn any topic in your language, through questions, not lectures
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base text-slate-300">
            AI Teacher is a free Socratic tutor. Tell it what you want to learn and it plans a
            short lesson, asks you questions instead of lecturing, draws diagrams, quizzes you, and
            re-teaches what you missed, in English, Hinglish, Hindi and 16 other languages.
          </p>

          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-white/15 bg-white/[0.04] p-3 text-left shadow-2xl shadow-indigo-950/40 focus-within:border-indigo-400"
          >
            <label htmlFor="lesson-prompt" className="sr-only">
              What do you want to learn?
            </label>
            <textarea
              id="lesson-prompt"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder={
                exam
                  ? `What do you want to revise for ${exam.label}? e.g. "${examPlaceholder(examPreset!)}"`
                  : "What do you want to learn? e.g. “How do vaccines train the immune system?”"
              }
              className="w-full resize-none bg-transparent px-2 py-1.5 text-base text-white placeholder:text-slate-400 focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <div role="radiogroup" aria-label="Lesson language" className="flex gap-1 rounded-lg bg-white/5 p-1">
                  {quickLanguages.map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={settings.language === value}
                      onClick={() => settings.onLanguageChange(value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-indigo-400 ${
                        settings.language === value
                          ? "bg-indigo-500 text-white"
                          : "text-slate-300 hover:text-white"
                      }`}
                    >
                      {LANGUAGE_META[value].label.replace(" (Mixed)", "")}
                    </button>
                  ))}
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) onUpload(file);
                  }}
                />
                {isUploading ? (
                  <span role="status" className="flex items-center gap-1.5 px-2 text-xs text-slate-300">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    Reading your file…
                  </span>
                ) : uploadedFileName ? (
                  <span className="flex items-center gap-1.5 rounded-lg bg-indigo-500/15 py-1 pl-2.5 pr-1 text-xs text-indigo-200">
                    <FileText size={14} aria-hidden="true" />
                    <span className="max-w-[12rem] truncate">{uploadedFileName}</span>
                    <button
                      type="button"
                      onClick={onClearUpload}
                      aria-label={`Remove ${uploadedFileName}`}
                      className="rounded p-0.5 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-indigo-400"
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-400"
                  >
                    <Paperclip size={14} aria-hidden="true" />
                    Attach notes or PDF
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={!draft.trim() || isUploading}
                className="flex items-center gap-1.5 rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-slate-400"
              >
                Start lesson
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </form>

          {uploadError && (
            <p role="alert" className="mt-2 text-left text-sm text-red-300">
              {uploadError}
            </p>
          )}

          <div className="mt-3 text-left">
            <AdvancedSettings settings={settings} />
          </div>

          {/* Exam prep */}
          <div className="mt-6 rounded-2xl border border-white/10 p-4 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span id="exam-prep-label" className="text-sm font-medium text-slate-200">
                Preparing for an exam?
              </span>
              <div role="group" aria-labelledby="exam-prep-label" className="flex flex-wrap gap-2">
                {EXAM_PRESETS.map((preset) => {
                  const active = examPreset === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onExamPresetChange(active ? null : preset)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-indigo-400 ${
                        active
                          ? "border-emerald-400 bg-emerald-500/20 text-emerald-200"
                          : "border-white/15 text-slate-300 hover:border-white/30 hover:text-white"
                      }`}
                    >
                      {EXAM_PRESET_META[preset].label}
                    </button>
                  );
                })}
              </div>
            </div>
            {exam ? (
              <p className="mt-2 text-sm text-slate-300">
                <span className="font-medium text-emerald-200">Exam prep: {exam.fullName}.</span>{" "}
                {exam.blurb}. Quizzes follow the real exam format.{" "}
                {uploadedFileName ? (
                  <>Lessons will follow <span className="text-white">{uploadedFileName}</span>.</>
                ) : (
                  <>
                    {exam.uploadHint} with <span className="text-white">Attach notes or PDF</span>{" "}
                    so lessons follow your syllabus.
                  </>
                )}
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-400">
                NISM, CFA and GATE modes teach from your own PDF and quiz you in the exam&apos;s format.
              </p>
            )}
          </div>
        </section>

        {/* Sample lessons */}
        <section aria-labelledby="samples-heading" className="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
          <h2 id="samples-heading" className="text-lg font-semibold text-white">
            Try a sample lesson
          </h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {SAMPLE_LESSONS.map((sample) => (
              <li key={sample.title}>
                <button
                  type="button"
                  onClick={() => onStart(sample.prompt, sample.language)}
                  className="group flex h-full w-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-indigo-400/60 hover:bg-indigo-500/10 focus-visible:outline-2 focus-visible:outline-indigo-400"
                >
                  <span className="text-xs font-medium text-indigo-300">{sample.tag}</span>
                  <span className="mt-1 font-semibold text-white">{sample.title}</span>
                  <span className="mt-1 text-sm text-slate-300">“{sample.prompt}”</span>
                  <span className="mt-3 flex items-center gap-1 text-xs font-medium text-indigo-300 group-hover:text-indigo-200">
                    Start this lesson <ArrowRight size={13} aria-hidden="true" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="border-t border-white/10 bg-white/[0.02]">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
            <h2 id="how-heading" className="text-lg font-semibold text-white">
              How it works
            </h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-indigo-300"
                  >
                    <step.icon size={18} />
                  </span>
                  <div>
                    <h3 className="font-semibold text-white">
                      <span className="sr-only">Step {i + 1}: </span>
                      {step.title}
                    </h3>
                    <p className="mt-1 text-sm text-slate-300">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function examPlaceholder(preset: ExamPreset): string {
  switch (preset) {
    case "nism":
      return "NISM Series V-A: types of mutual fund schemes";
    case "cfa":
      return "CFA Level I: time value of money";
    case "gate":
      return "GATE CSE: deadlock and the Banker's algorithm";
  }
}

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto grid max-w-5xl gap-6 px-4 py-10 text-sm text-slate-300 sm:px-6 md:grid-cols-3">
        <div>
          <h2 className="font-semibold text-white">Privacy</h2>
          <p className="mt-1">
            No account needed. Your progress is saved only in this browser. Your questions are sent
            to the AI model to write each reply, and uploaded files are held in temporary server
            memory for your lesson. We count anonymous usage (lessons, quiz scores, language) with
            no cookies, IDs or lesson content.
          </p>
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
