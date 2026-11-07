"use client";

import { useId, useMemo, useState } from "react";
import { FileText, Loader2, Shuffle, Sparkles, Target } from "lucide-react";
import type { CourseSummary, PracticeQuestion } from "@/lib/course/schemas";
import { postCourse } from "@/lib/course/client";
import { pickChapterByWeight, syllabusFor, weightageLabel } from "@/lib/exams/syllabi";
import {
  EXAM_PRESET_META,
  type ExamPreset,
  type Language,
  type OutlineChapter,
  type TeacherModelId,
} from "@/lib/types";
import { CitationChip } from "./citation-chip";
import { QuestionCard } from "./question-card";

type SourceKind = "document" | "exam" | "topic";
type Difficulty = "easy" | "medium" | "hard" | "mixed";
type Types = "mcq" | "descriptive" | "mixed";

export interface PracticeDocument {
  docId: string;
  fileName: string;
  outline: OutlineChapter[];
}

const selectClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none";

export function PracticePanel({
  document,
  examPreset,
  currentTopic,
  language,
  modelId,
  onPracticeAnswer,
}: {
  document: PracticeDocument | null;
  examPreset: ExamPreset | null;
  currentTopic: string | null;
  language: Language;
  modelId: TeacherModelId;
  /** Feeds the mastery engine: one call per checked or marked answer. */
  onPracticeAnswer: (concept: string, correct: boolean, topic: string) => void;
}) {
  const id = useId();
  const syllabus = examPreset ? syllabusFor(examPreset) : null;
  const hasOutline = Boolean(document && document.outline.length > 0);

  const available = useMemo(() => {
    const kinds: SourceKind[] = [];
    if (hasOutline) kinds.push("document");
    if (syllabus) kinds.push("exam");
    kinds.push("topic");
    return kinds;
  }, [hasOutline, syllabus]);

  const [preferredKind, setKind] = useState<SourceKind | null>(null);
  const kind: SourceKind = preferredKind && available.includes(preferredKind) ? preferredKind : available[0];

  const [docChapter, setDocChapter] = useState("");
  const [examChapter, setExamChapter] = useState("");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("mixed");
  const [types, setTypes] = useState<Types>(examPreset === "board" ? "mixed" : "mcq");
  const [count, setCount] = useState(5);

  const [busy, setBusy] = useState<"summary" | "questions" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CourseSummary | null>(null);
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [setLabel, setSetLabel] = useState("");
  const [score, setScore] = useState({ answered: 0, correct: 0 });

  const docChapterId = docChapter || document?.outline[0]?.id || "";
  const examChapterId = examChapter || syllabus?.chapters[0]?.id || "";
  const topicText = (topic || currentTopic || "").trim();

  const docChapterTitle = document?.outline.find((c) => c.id === docChapterId)?.title ?? "";
  const examChapterTitle = syllabus?.chapters.find((c) => c.id === examChapterId)?.title ?? "";
  const sourceLabel =
    kind === "document" ? docChapterTitle : kind === "exam" ? `${syllabus?.name ?? ""}: ${examChapterTitle}` : topicText;

  const summarise = async () => {
    if (!document || !docChapterId) return;
    setBusy("summary");
    setError(null);
    const data = await postCourse({ action: "summary", docId: document.docId, chapterId: docChapterId, language, modelId });
    setBusy(null);
    if (!data.ok) return void setError(data.error);
    if ("summary" in data) setSummary(data.summary);
  };

  const generate = async (examChapterOverride?: string) => {
    const chapterForExam = examChapterOverride ?? examChapterId;
    const source =
      kind === "document"
        ? { kind: "document", docId: document?.docId, chapterId: docChapterId }
        : kind === "exam"
          ? { kind: "exam", exam: examPreset, chapterId: chapterForExam }
          : { kind: "topic", topic: topicText };
    if (kind === "topic" && topicText.length < 2) return void setError("Type a topic to practise first.");

    setBusy("questions");
    setError(null);
    const data = await postCourse({
      action: "questions",
      source,
      count,
      difficulty,
      types,
      examPreset: examPreset ?? undefined,
      language,
      modelId,
    });
    setBusy(null);
    if (!data.ok) return void setError(data.error);
    if ("questions" in data) {
      setQuestions(data.questions);
      setScore({ answered: 0, correct: 0 });
      const chapterTitle = syllabus?.chapters.find((c) => c.id === chapterForExam)?.title;
      setSetLabel(kind === "exam" && chapterTitle ? `${syllabus?.name}: ${chapterTitle}` : sourceLabel);
    }
  };

  const practiseByWeight = () => {
    if (!syllabus) return;
    const chapter = pickChapterByWeight(syllabus.chapters);
    if (!chapter) return;
    setExamChapter(chapter.id);
    void generate(chapter.id);
  };

  const handleAnswered = (question: PracticeQuestion, correct: boolean) => {
    setScore((s) => ({ answered: s.answered + 1, correct: s.correct + (correct ? 1 : 0) }));
    onPracticeAnswer(question.concept, correct, setLabel || sourceLabel);
  };

  const sourceTabs: { kind: SourceKind; label: string; icon: typeof FileText }[] = [
    { kind: "document", label: "My notes", icon: FileText },
    { kind: "exam", label: examPreset ? EXAM_PRESET_META[examPreset].label : "Exam", icon: Target },
    { kind: "topic", label: "Topic", icon: Sparkles },
  ];

  return (
    <div className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Practise</h3>
        <p className="text-xs text-slate-500">
          Summaries and questions with explanations. Descriptive answers are marked against a marking scheme.
        </p>
      </div>

      {available.length > 1 && (
        <div role="group" aria-label="Practise from" className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {sourceTabs
            .filter((t) => available.includes(t.kind))
            .map(({ kind: k, label, icon: Icon }) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  kind === k ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                {label}
              </button>
            ))}
        </div>
      )}

      {kind === "document" && document && (
        <div>
          <label htmlFor={`${id}-doc`} className="text-xs font-medium text-slate-600">
            Chapter of {document.fileName}
          </label>
          <select id={`${id}-doc`} value={docChapterId} onChange={(e) => setDocChapter(e.target.value)} className={selectClass}>
            {document.outline.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.locator ? ` (${c.locator})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {kind === "exam" && syllabus && (
        <div>
          <label htmlFor={`${id}-exam`} className="text-xs font-medium text-slate-600">
            {syllabus.name} chapter
          </label>
          <select id={`${id}-exam`} value={examChapterId} onChange={(e) => setExamChapter(e.target.value)} className={selectClass}>
            {syllabus.chapters.map((c) => {
              const weight = weightageLabel(c);
              return (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {weight ? ` · ${weight}` : ""}
                </option>
              );
            })}
          </select>
          {syllabus.status !== "verified" && (
            <p className="mt-1 text-[11px] text-amber-700">
              Syllabus map is a {syllabus.status}: weightage not yet checked against the official document.
            </p>
          )}
        </div>
      )}

      {kind === "topic" && (
        <div>
          <label htmlFor={`${id}-topic`} className="text-xs font-medium text-slate-600">
            Topic
          </label>
          <input
            id={`${id}-topic`}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={currentTopic ?? "e.g. Photosynthesis"}
            maxLength={200}
            className={selectClass}
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor={`${id}-difficulty`} className="text-xs font-medium text-slate-600">
            Difficulty
          </label>
          <select
            id={`${id}-difficulty`}
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            className={selectClass}
          >
            <option value="mixed">Mixed</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-types`} className="text-xs font-medium text-slate-600">
            Type
          </label>
          <select id={`${id}-types`} value={types} onChange={(e) => setTypes(e.target.value as Types)} className={selectClass}>
            <option value="mcq">MCQ</option>
            <option value="descriptive">Descriptive</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-count`} className="text-xs font-medium text-slate-600">
            Questions
          </label>
          <select id={`${id}-count`} value={count} onChange={(e) => setCount(Number(e.target.value))} className={selectClass}>
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy !== null}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Sparkles size={14} aria-hidden="true" />
          Generate questions
        </button>
        {kind === "document" && (
          <button
            type="button"
            onClick={() => void summarise()}
            disabled={busy !== null}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <FileText size={14} aria-hidden="true" />
            Summarise chapter
          </button>
        )}
        {kind === "exam" && syllabus && (
          <button
            type="button"
            onClick={practiseByWeight}
            disabled={busy !== null}
            title="Picks a chapter at random, weighted by its share of the exam's marks"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Shuffle size={14} aria-hidden="true" />
            Practise by weightage
          </button>
        )}
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {busy && (
          <span className="inline-flex items-center gap-2 text-slate-500">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {busy === "summary" ? "Summarising…" : "Writing questions…"}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      )}

      {summary && (
        <section aria-label="Chapter summary" className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <h4 className="text-sm font-semibold text-slate-800">{summary.chapterTitle}</h4>
          <p className="mt-1 text-sm text-slate-700">{summary.overview}</p>
          <ul className="mt-3 space-y-2">
            {summary.keyPoints.map((k, i) => (
              <li key={i} className="text-sm text-slate-700">
                <span className="mr-1">•</span>
                {k.point} <CitationChip citation={k.citation} />
              </li>
            ))}
          </ul>
          {summary.notCovered && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="font-semibold">Not in your notes: </span>
              {summary.notCovered}
            </p>
          )}
        </section>
      )}

      {questions.length > 0 && (
        <section aria-label="Practice questions" className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="min-w-0 truncate text-sm font-semibold text-slate-800">{setLabel}</h4>
            {score.answered > 0 && (
              <span className="shrink-0 text-xs text-slate-500">
                {score.correct} / {score.answered} right
              </span>
            )}
          </div>
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              question={q}
              number={i + 1}
              language={language}
              modelId={modelId}
              examPreset={examPreset ?? undefined}
              onAnswered={handleAnswered}
            />
          ))}
        </section>
      )}
    </div>
  );
}
