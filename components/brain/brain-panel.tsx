"use client";

import { useState, type ReactNode } from "react";
import { BrainCircuit, ClipboardCheck, GraduationCap, MessagesSquare } from "lucide-react";
import type {
  ChatMessage,
  ConceptNode,
  Language,
  LearnerProfileRecord,
  RetrievedChunk,
} from "@/lib/types";
import { SkillTree } from "./skill-tree";
import { ChatInterface } from "./chat-interface";
import { ProgressPanel } from "./progress-panel";
import { GroundingTrace } from "./grounding-trace";
import type { MasteryView } from "@/lib/learning/state";
import type { LearningActions } from "./chat-interface";

type Tab = "lesson" | "practice" | "progress";

export function BrainPanel({
  concepts,
  celebratingConceptId,
  messages,
  onSend,
  isThinking,
  language,
  isTeacherSpeaking,
  onListeningChange,
  onUnlockAudio,
  profile,
  onResetProfile,
  groundedOn,
  documentName,
  onUpload,
  isUploading,
  uploadError,
  uploadedFileName,
  onClearUpload,
  notices,
  mastery,
  learningActions,
  practice,
}: {
  concepts: ConceptNode[];
  /** Concept id to flash a mastery-ping on right now, or null for none. */
  celebratingConceptId: string | null;
  messages: ChatMessage[];
  onSend: (content: string) => void;
  isThinking: boolean;
  language: Language;
  isTeacherSpeaking: boolean;
  onListeningChange: (isListening: boolean) => void;
  onUnlockAudio: () => void;
  profile: LearnerProfileRecord;
  onResetProfile: () => void;
  groundedOn: RetrievedChunk[];
  documentName: string | null;
  /** Wired to handleUpload in dashboard.tsx — the same pipeline the Stage panel's dropzone uses. */
  onUpload: (file: File) => void;
  isUploading: boolean;
  uploadError: string | null;
  uploadedFileName: string | null;
  onClearUpload: () => void;
  /** Banners shown above the chat: a failed-turn retry, the feedback card. */
  notices?: ReactNode;
  mastery?: Record<string, MasteryView | null>;
  /** Hint ladder and teach-back buttons shown above the chat input. */
  learningActions?: LearningActions;
  /** The Practice tab's content (summaries, questions, marking). */
  practice?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("lesson");
  const topicCount = profile.topics.length;

  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-2.5">
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          <BrainCircuit size={18} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-800">The Socratic Brain</h2>
        </div>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            aria-pressed={tab === "lesson"}
            onClick={() => setTab("lesson")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              tab === "lesson"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <MessagesSquare size={13} />
            Lesson
          </button>
          {practice && (
            <button
              type="button"
              aria-pressed={tab === "practice"}
              onClick={() => setTab("practice")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                tab === "practice"
                  ? "bg-white text-slate-800 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <ClipboardCheck size={13} />
              Practice
            </button>
          )}
          <button
            type="button"
            aria-pressed={tab === "progress"}
            onClick={() => setTab("progress")}
            title="Everything saved about your learning on this device"
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              tab === "progress"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <GraduationCap size={13} />
            Progress
            {topicCount > 0 && (
              <span className="rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-700">
                {topicCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Kept mounted (just hidden) so a half-answered practice set survives a tab switch. */}
      {practice && (
        <div className={tab === "practice" ? "min-h-0 flex-1 overflow-y-auto" : "hidden"}>{practice}</div>
      )}
      {tab === "practice" ? null : tab === "progress" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProgressPanel profile={profile} onReset={onResetProfile} />
        </div>
      ) : (
        <>
          <div className="border-b border-slate-200">
            <SkillTree
              concepts={concepts}
              celebratingConceptId={celebratingConceptId}
              mastery={mastery}
            />
          </div>

          <GroundingTrace chunks={groundedOn} documentName={documentName} />

          {notices}

          <div className="min-h-0 flex-1">
            <ChatInterface
              messages={messages}
              onSend={onSend}
              isThinking={isThinking}
              language={language}
              isTeacherSpeaking={isTeacherSpeaking}
              onListeningChange={onListeningChange}
              onUnlockAudio={onUnlockAudio}
              onUpload={onUpload}
              isUploading={isUploading}
              uploadError={uploadError}
              uploadedFileName={uploadedFileName}
              onClearUpload={onClearUpload}
              learningActions={learningActions}
            />
          </div>
        </>
      )}
    </section>
  );
}
