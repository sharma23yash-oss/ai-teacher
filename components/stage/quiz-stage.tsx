"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ConceptNode, QuizQuestion, QuizReport } from "@/lib/types";
import { ReportCard } from "./report-card";

function buildReport(
  questions: QuizQuestion[],
  answers: (number | null)[],
  conceptPlan: ConceptNode[],
): QuizReport {
  const total = questions.length;
  const correctCount = questions.filter((q, i) => answers[i] === q.correct_index).length;
  const scorePercent = total === 0 ? 0 : Math.round((correctCount / total) * 100);

  const wrongConceptIds = new Set(
    questions
      .filter((q, i) => q.concept_id && answers[i] !== q.correct_index)
      .map((q) => q.concept_id as string),
  );
  const rightConceptIds = new Set(
    questions
      .filter((q, i) => q.concept_id && answers[i] === q.correct_index)
      .map((q) => q.concept_id as string),
  );

  const masteredConcepts: string[] = [];
  const weakConcepts: string[] = [];

  for (const concept of conceptPlan) {
    if (wrongConceptIds.has(concept.id)) {
      weakConcepts.push(concept.label);
    } else if (rightConceptIds.has(concept.id) || concept.status === "completed") {
      masteredConcepts.push(concept.label);
    }
  }

  const nextUnmastered = conceptPlan.find((c) => c.status !== "completed");
  const recommendation =
    weakConcepts.length > 0
      ? `Revisit "${weakConcepts[0]}" with a few more practice questions before moving on.`
      : nextUnmastered
        ? `Great work — move on to "${nextUnmastered.label}" next.`
        : "You've mastered every concept in this lesson — time for a harder topic!";

  return { scorePercent, masteredConcepts, weakConcepts, recommendation };
}

export function QuizStage({
  questions,
  conceptPlan,
  onAnswered,
  onCompleted,
}: {
  questions: QuizQuestion[];
  conceptPlan: ConceptNode[];
  onAnswered: (correct: boolean) => void;
  onCompleted: (report: QuizReport) => void;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const reportedRef = useRef(false);
  const allAnswered = answers.every((a) => a !== null);

  useEffect(() => {
    if (!allAnswered || reportedRef.current) return;
    reportedRef.current = true;
    onCompleted(buildReport(questions, answers, conceptPlan));
  }, [allAnswered, questions, answers, conceptPlan, onCompleted]);

  function selectAnswer(questionIndex: number, optionIndex: number) {
    if (answers[questionIndex] !== null) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = optionIndex;
      return next;
    });
    onAnswered(optionIndex === questions[questionIndex].correct_index);
  }

  if (allAnswered) {
    return <ReportCard report={buildReport(questions, answers, conceptPlan)} />;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-5">
        {questions.map((q, qi) => {
          const selected = answers[qi];
          return (
            <div key={q.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-sm font-medium text-slate-100">
                {qi + 1}. {q.question}
              </p>
              <div className="flex flex-col gap-2">
                {q.options.map((option, oi) => {
                  const isCorrect = oi === q.correct_index;
                  const isSelected = selected === oi;

                  let style =
                    "border-white/15 bg-white/5 text-slate-300 hover:border-indigo-400/50";
                  if (selected !== null) {
                    if (isCorrect) {
                      style = "border-emerald-500/60 bg-emerald-500/10 text-emerald-300";
                    } else if (isSelected) {
                      style = "border-red-500/60 bg-red-500/10 text-red-300";
                    } else {
                      style = "border-white/10 bg-white/5 text-slate-500";
                    }
                  }

                  return (
                    <button
                      key={oi}
                      onClick={() => selectAnswer(qi, oi)}
                      disabled={selected !== null}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${style} ${
                        selected === null ? "cursor-pointer" : "cursor-default"
                      }`}
                    >
                      <span>{option}</span>
                      {selected !== null && isCorrect && (
                        <CheckCircle2 size={16} className="shrink-0" />
                      )}
                      {selected !== null && isSelected && !isCorrect && (
                        <XCircle size={16} className="shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
              {selected !== null && (
                <p className="mt-3 rounded-md bg-black/20 p-2.5 text-xs text-slate-400">
                  {q.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
