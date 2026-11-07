"use client";

import { useId, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { GradeResult, PracticeQuestion } from "@/lib/course/schemas";
import { postCourse } from "@/lib/course/client";
import type { ExamPreset, Language, TeacherModelId } from "@/lib/types";
import { CitationChip } from "./citation-chip";

const DIFFICULTY_STYLE: Record<PracticeQuestion["difficulty"], string> = {
  easy: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  hard: "bg-rose-50 text-rose-700",
};

/** A descriptive answer counts as "correct" for mastery at 60% of the marks. */
export const DESCRIPTIVE_PASS_RATIO = 0.6;

export function QuestionCard({
  question,
  number,
  language,
  modelId,
  examPreset,
  onAnswered,
}: {
  question: PracticeQuestion;
  number: number;
  language: Language;
  modelId: TeacherModelId;
  examPreset?: ExamPreset;
  /** Called once, when the answer is first checked or marked. */
  onAnswered: (question: PracticeQuestion, correct: boolean) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [answer, setAnswer] = useState("");
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkMcq = () => {
    if (choice === null || checked) return;
    setChecked(true);
    onAnswered(question, choice === question.answerIndex);
  };

  const markAnswer = async () => {
    if (!answer.trim() || !question.markingScheme || grade) return;
    setGrading(true);
    setError(null);
    const data = await postCourse({
      action: "grade",
      question: question.question,
      modelAnswer: question.modelAnswer,
      markingScheme: question.markingScheme,
      marks: question.marks,
      studentAnswer: answer,
      examPreset,
      language,
      modelId,
    });
    setGrading(false);
    if (!data.ok) {
      setError(data.error);
      return;
    }
    if (!("grade" in data)) {
      setError("Unexpected reply from the server.");
      return;
    }
    setGrade(data.grade);
    onAnswered(question, data.grade.max > 0 && data.grade.total / data.grade.max >= DESCRIPTIVE_PASS_RATIO);
  };

  const correct = checked && choice === question.answerIndex;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`${id}-q`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
        <span className="text-slate-500">Q{number}</span>
        <span className={`rounded-full px-2 py-0.5 capitalize ${DIFFICULTY_STYLE[question.difficulty]}`}>
          {question.difficulty}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
          {question.marks} {question.marks === 1 ? "mark" : "marks"}
        </span>
        <span className="min-w-0 truncate text-slate-500">{question.concept}</span>
      </div>

      <p id={`${id}-q`} className="text-sm font-medium whitespace-pre-line text-slate-800">
        {question.question}
      </p>

      {question.type === "mcq" && question.options ? (
        <fieldset className="mt-3" disabled={checked}>
          <legend className="sr-only">Choose one answer</legend>
          <div className="space-y-1.5">
            {question.options.map((option, i) => {
              const isAnswer = checked && i === question.answerIndex;
              const isWrongPick = checked && i === choice && i !== question.answerIndex;
              return (
                <label
                  key={i}
                  className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    isAnswer
                      ? "border-emerald-400 bg-emerald-50"
                      : isWrongPick
                        ? "border-rose-400 bg-rose-50"
                        : choice === i
                          ? "border-indigo-400 bg-indigo-50"
                          : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${id}-mcq`}
                    className="mt-0.5 accent-indigo-600"
                    checked={choice === i}
                    onChange={() => setChoice(i)}
                  />
                  <span className="text-slate-700">{option}</span>
                  {isAnswer && <span className="sr-only"> (correct answer)</span>}
                </label>
              );
            })}
          </div>
          {!checked && (
            <button
              type="button"
              onClick={checkMcq}
              disabled={choice === null}
              className="mt-3 min-h-10 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Check
            </button>
          )}
        </fieldset>
      ) : (
        <div className="mt-3">
          <label htmlFor={`${id}-answer`} className="text-xs font-medium text-slate-600">
            Your answer
          </label>
          <textarea
            id={`${id}-answer`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={4000}
            rows={5}
            disabled={grading || grade !== null}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none disabled:bg-slate-50"
            placeholder="Write it as you would in the exam."
          />
          {grade === null && (
            <button
              type="button"
              onClick={() => void markAnswer()}
              disabled={grading || !answer.trim()}
              className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              {grading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {grading ? "Marking…" : "Mark my answer"}
            </button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-sm text-rose-700">
              {error}
            </p>
          )}
        </div>
      )}

      <div aria-live="polite">
        {checked && (
          <Feedback correct={correct} title={correct ? "Correct" : "Not quite"}>
            {question.explanation}
          </Feedback>
        )}
        {grade && <GradeTable grade={grade} question={question} />}
      </div>

      {(checked || grade) && question.citation && (
        <div className="mt-2">
          <CitationChip citation={question.citation} />
        </div>
      )}
    </article>
  );
}

function Feedback({ correct, title, children }: { correct: boolean; title: string; children: ReactNode }) {
  const Icon = correct ? CheckCircle2 : XCircle;
  return (
    <div
      className={`mt-3 rounded-lg px-3 py-2 text-sm ${correct ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <Icon size={15} aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 whitespace-pre-line">{children}</p>
    </div>
  );
}

function GradeTable({ grade, question }: { grade: GradeResult; question: PracticeQuestion }) {
  const passed = grade.max > 0 && grade.total / grade.max >= DESCRIPTIVE_PASS_RATIO;
  return (
    <div className="mt-3 space-y-3">
      <Feedback correct={passed} title={`${grade.total} / ${grade.max} marks`}>
        {grade.feedback}
      </Feedback>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Marks awarded for each point of the marking scheme</caption>
          <thead className="text-slate-500">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">
                Marking point
              </th>
              <th scope="col" className="py-1 pr-2 font-medium whitespace-nowrap">
                Marks
              </th>
              <th scope="col" className="py-1 font-medium">
                Comment
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {grade.points.map((p, i) => (
              <tr key={i} className="align-top">
                <td className="py-1.5 pr-2">{p.point}</td>
                <td className="py-1.5 pr-2 font-semibold whitespace-nowrap">
                  {p.awarded} / {p.max}
                </td>
                <td className="py-1.5">{p.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grade.improve && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">To improve: </span>
          {grade.improve}
        </p>
      )}
      {question.modelAnswer && (
        <details className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <summary className="cursor-pointer font-medium">Model answer</summary>
          <p className="mt-1 whitespace-pre-line">{question.modelAnswer}</p>
        </details>
      )}
      <p className="text-sm text-slate-600">{question.explanation}</p>
    </div>
  );
}
