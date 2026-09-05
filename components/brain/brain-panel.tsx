"use client";

import { BrainCircuit } from "lucide-react";
import type { ChatMessage, ConceptNode, Language } from "@/lib/types";
import { SkillTree } from "./skill-tree";
import { ChatInterface } from "./chat-interface";

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
}) {
  return (
    <section className="flex h-full flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
        <BrainCircuit size={18} className="text-indigo-600" />
        <h2 className="text-sm font-semibold text-slate-800">The Socratic Brain</h2>
      </header>

      <div className="border-b border-slate-200">
        <SkillTree concepts={concepts} celebratingConceptId={celebratingConceptId} />
      </div>

      <div className="min-h-0 flex-1">
        <ChatInterface
          messages={messages}
          onSend={onSend}
          isThinking={isThinking}
          language={language}
          isTeacherSpeaking={isTeacherSpeaking}
          onListeningChange={onListeningChange}
          onUnlockAudio={onUnlockAudio}
        />
      </div>
    </section>
  );
}
