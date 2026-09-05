"use client";

import { useState } from "react";
import {
  Clapperboard,
  Code2,
  ListChecks,
  Loader2,
  UserRound,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Workflow,
} from "lucide-react";
import type { MouthFrame } from "@/lib/audio-engine";
import type { GestureEngineStatus, HeadPose } from "@/lib/use-gesture-recognition";
import { SHOWCASE_MODE } from "@/lib/build-flags";
import type {
  GestureSignal,
  Language,
  LearnerLevel,
  LessonPayload,
  QuizReport,
  TeacherModelId,
  TeacherPersona,
  TimeBudget,
  VideoRefCallback,
  VisualMode,
  VoiceGender,
} from "@/lib/types";
import type { AvatarState } from "./avatar-face";
import { VideoStage } from "./video-stage";
import { AvatarScene } from "./avatar-scene";
import { AvatarOverlay } from "./avatar-overlay";
import { CodeStage } from "./code-stage";
import { DiagramStage } from "./diagram-stage";
import { QuizStage } from "./quiz-stage";
import { VideoCallStage } from "./video-call-stage";
import { VideoCallOverlay } from "./video-call-overlay";
import { UploadDropzone } from "./upload-dropzone";
import { ModelSelector } from "./model-selector";
import { PersonaSelector } from "./persona-selector";
import { VoiceSelector } from "./voice-selector";
import { LanguageSelector } from "./language-selector";
import { LevelSelector } from "./level-selector";
import { TimeBudgetSelector } from "./time-budget-selector";

type StageMode = "avatar" | "code" | "diagram" | "video" | "quiz" | "videocall";

const MODE_TABS: { mode: StageMode; label: string; icon: typeof UserRound }[] = [
  { mode: "avatar", label: "Teacher", icon: UserRound },
  { mode: "code", label: "Code", icon: Code2 },
  { mode: "diagram", label: "Diagram", icon: Workflow },
  { mode: "video", label: "Video", icon: Clapperboard },
  { mode: "videocall", label: "Call", icon: Video },
];

function toStageMode(visualMode: VisualMode): StageMode {
  return visualMode === "concept_flow" ? "diagram" : visualMode;
}

export interface StagePanelProps {
  isFeynmanMode: boolean;
  onToggleFeynmanMode: () => void;
  canToggleFeynmanMode: boolean;
  lesson: LessonPayload;
  uploadedFileName: string | null;
  isUploading: boolean;
  uploadError: string | null;
  onUpload: (file: File) => void;
  onClearUpload: () => void;
  model: TeacherModelId;
  onModelChange: (model: TeacherModelId) => void;
  extendedThinking: boolean;
  onExtendedThinkingChange: (enabled: boolean) => void;
  persona: TeacherPersona;
  onPersonaChange: (persona: TeacherPersona) => void;
  voiceGender: VoiceGender;
  onVoiceGenderChange: (voiceGender: VoiceGender) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  learnerLevel: LearnerLevel;
  onLearnerLevelChange: (level: LearnerLevel) => void;
  timeBudget: TimeBudget;
  onTimeBudgetChange: (timeBudget: TimeBudget) => void;
  avatarState: AvatarState;
  readMouthFrame: () => MouthFrame;
  isAudioBlocked: boolean;
  onReplayAudio: () => void;
  onTakeQuiz: () => void;
  isQuizLoading: boolean;
  onQuizAnswered: (correct: boolean) => void;
  onQuizCompleted: (report: QuizReport) => void;
  isVideoCallActive: boolean;
  onToggleVideoCall: () => void;
  videoCallError: string | null;
  attachVideoElement: VideoRefCallback;
  gestureStatus: GestureEngineStatus;
  gestureError: string | null;
  isGestureTracking: boolean;
  rawGesture: string | null;
  headPose: HeadPose | null;
  lastGestureSignal: GestureSignal | null;
  lastGestureSignalId: number;
}

export function StagePanel({
  isFeynmanMode,
  onToggleFeynmanMode,
  canToggleFeynmanMode,
  lesson,
  uploadedFileName,
  isUploading,
  uploadError,
  onUpload,
  onClearUpload,
  model,
  onModelChange,
  extendedThinking,
  onExtendedThinkingChange,
  persona,
  onPersonaChange,
  voiceGender,
  onVoiceGenderChange,
  language,
  onLanguageChange,
  learnerLevel,
  onLearnerLevelChange,
  timeBudget,
  onTimeBudgetChange,
  avatarState,
  readMouthFrame,
  isAudioBlocked,
  onReplayAudio,
  onTakeQuiz,
  isQuizLoading,
  onQuizAnswered,
  onQuizCompleted,
  isVideoCallActive,
  onToggleVideoCall,
  videoCallError,
  attachVideoElement,
  gestureStatus,
  gestureError,
  isGestureTracking,
  rawGesture,
  headPose,
  lastGestureSignal,
  lastGestureSignalId,
}: StagePanelProps) {
  const [mode, setMode] = useState<StageMode>(() => toStageMode(lesson.visual_director.mode));
  // Tracks which `lesson` the current `mode` was derived from, so we can
  // re-sync the Stage on every new AI turn while leaving a manual tab pick
  // alone in between turns — the sanctioned render-time alternative to an
  // effect for "adjust state when a prop changes" (react.dev/learn/you-might-not-need-an-effect).
  const [syncedLesson, setSyncedLesson] = useState(lesson);
  if (lesson !== syncedLesson) {
    setSyncedLesson(lesson);
    const next = toStageMode(lesson.visual_director.mode);
    // Never yank the student out of a live call just to show a talking head —
    // the call already shows one. Code, diagrams and quizzes still take over,
    // with the call demoted to the picture-in-picture preview.
    if (!(isVideoCallActive && mode === "videocall" && next === "avatar")) {
      setMode(next);
    }
  }

  // Starting or ending a call is an explicit request to look at it.
  const [syncedCallActive, setSyncedCallActive] = useState(isVideoCallActive);
  if (isVideoCallActive !== syncedCallActive) {
    setSyncedCallActive(isVideoCallActive);
    setMode(isVideoCallActive ? "videocall" : toStageMode(lesson.visual_director.mode));
  }

  const showAvatarOverlay = mode === "code" || mode === "diagram" || mode === "quiz";
  const showVideoPip = isVideoCallActive && mode !== "videocall";

  return (
    <section className="flex h-full flex-col bg-slate-950">
      <header className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-indigo-400">
            The Stage
          </p>
          <h2 className="flex items-center gap-2 text-sm text-slate-300">
            Phase:{" "}
            <span className="font-semibold text-slate-100">{lesson.teaching_phase}</span>
            {avatarState === "talking" && (
              <span className="flex items-center gap-1 text-xs font-medium text-indigo-400">
                <Volume2 size={13} className="animate-pulse" />
                Speaking…
              </span>
            )}
            {isAudioBlocked && (
              <button
                onClick={onReplayAudio}
                className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300 transition hover:bg-amber-500/25"
                title="Your browser blocked automatic audio — tap to hear this turn"
              >
                <VolumeX size={12} />
                Tap to listen
              </button>
            )}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onToggleFeynmanMode}
            disabled={!canToggleFeynmanMode && !isFeynmanMode}
            title={
              canToggleFeynmanMode || isFeynmanMode
                ? "Reverse Socratic (Feynman Crucible) Mode — you teach, the AI plays a confused student"
                : "Pick a topic first — Feynman Mode needs a concept in progress to reverse"
            }
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              isFeynmanMode
                ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400"
                : "border-white/10 bg-white/5 text-slate-400 hover:text-white"
            }`}
          >
            {isFeynmanMode && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            )}
            {isFeynmanMode ? "🧪 Feynman Mode: ON" : "🧪 Teach Me (Feynman)"}
          </button>
          <div className="flex gap-1 rounded-lg bg-white/5 p-1">
            {MODE_TABS.map(({ mode: tabMode, label, icon: Icon }) => (
              <button
                key={tabMode}
                onClick={() => setMode(tabMode)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  mode === tabMode
                    ? "bg-indigo-500 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Icon size={14} />
                <span className="hidden lg:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <ModelSelector
            model={model}
            onModelChange={onModelChange}
            extendedThinking={extendedThinking}
            onExtendedThinkingChange={onExtendedThinkingChange}
          />
          <PersonaSelector persona={persona} onPersonaChange={onPersonaChange} />
          <VoiceSelector
            persona={persona}
            voiceGender={voiceGender}
            onVoiceGenderChange={onVoiceGenderChange}
          />
          <LanguageSelector language={language} onLanguageChange={onLanguageChange} />
          <LevelSelector
            learnerLevel={learnerLevel}
            onLearnerLevelChange={onLearnerLevelChange}
          />
          <TimeBudgetSelector timeBudget={timeBudget} onTimeBudgetChange={onTimeBudgetChange} />
          <button
            onClick={onTakeQuiz}
            disabled={isQuizLoading}
            className="flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isQuizLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ListChecks size={13} />
            )}
            Take Quiz / Assessment
          </button>
          <button
            onClick={onToggleVideoCall}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white transition ${
              isVideoCallActive
                ? "bg-red-600 hover:bg-red-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {isVideoCallActive ? <VideoOff size={13} /> : <Video size={13} />}
            {isVideoCallActive ? "End Video Call" : "Start Video Call"}
          </button>
          {videoCallError && (
            <span className="max-w-[16rem] truncate text-xs text-red-400" title={videoCallError}>
              {videoCallError}
            </span>
          )}
        </div>
        <UploadDropzone
          uploadedFileName={uploadedFileName}
          isUploading={isUploading}
          uploadError={uploadError}
          onUpload={onUpload}
          onClearUpload={onClearUpload}
        />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div key={mode} className="stage-fade-in h-full w-full">
          {mode === "avatar" && (
            <AvatarScene
              persona={persona}
              voiceGender={voiceGender}
              state={avatarState}
              readMouthFrame={readMouthFrame}
            />
          )}
          {mode === "code" &&
            (lesson.visual_director.code_snippet ? (
              <CodeStage
                code={lesson.visual_director.code_snippet}
                highlightLines={lesson.visual_director.highlight_lines ?? []}
              />
            ) : (
              <EmptyStageState message="No code snippet for this step yet." />
            ))}
          {mode === "diagram" &&
            (lesson.visual_director.diagram_data ? (
              <DiagramStage data={lesson.visual_director.diagram_data} />
            ) : (
              <EmptyStageState message="No diagram for this step yet." />
            ))}
          {mode === "video" && (
            <VideoStage
              lesson={lesson}
              persona={persona}
              language={language}
              learnerLevel={learnerLevel}
              voiceGender={voiceGender}
            />
          )}
          {mode === "videocall" && (
            <VideoCallStage
              videoRef={attachVideoElement}
              isCallActive={isVideoCallActive}
              cameraError={videoCallError}
              persona={persona}
              voiceGender={voiceGender}
              avatarState={avatarState}
              readMouthFrame={readMouthFrame}
              engineStatus={gestureStatus}
              engineError={gestureError}
              isTracking={isGestureTracking}
              rawGesture={rawGesture}
              headPose={headPose}
              lastSignal={lastGestureSignal}
              lastSignalId={lastGestureSignalId}
            />
          )}
          {mode === "quiz" &&
            (lesson.visual_director.questions && lesson.visual_director.questions.length > 0 ? (
              <QuizStage
                key={lesson.visual_director.questions.map((q) => q.id).join(",")}
                questions={lesson.visual_director.questions}
                conceptPlan={lesson.concept_plan}
                onAnswered={onQuizAnswered}
                onCompleted={onQuizCompleted}
              />
            ) : (
              <EmptyStageState message="No quiz questions yet." />
            ))}
        </div>

        {showVideoPip && (
          <VideoCallOverlay
            videoRef={attachVideoElement}
            lastSignal={lastGestureSignal}
            isTracking={isGestureTracking}
          />
        )}

        <div className="absolute bottom-4 right-4 flex items-end gap-4 z-50">
          {/* Sponsor placement — personal build only. Off by default so the
              teaching surface stays clean for anyone evaluating the product.
              See lib/build-flags.ts. */}
          {SHOWCASE_MODE && (
            <a
              href="https://www.royalenfield.com/in/en/gma/bullet/"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#111111]/90 backdrop-blur-md border border-[#D32F2F]/50 py-2 px-3 rounded-xl shadow-2xl hover:bg-black hover:border-[#D32F2F] transition-all z-50 flex items-center gap-3 max-w-[280px] text-left cursor-pointer"
            >
              <div className="shrink-0 bg-white/5 rounded-lg p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="https://www.royalenfield.com/content/dam/royal-enfield/india/motorcycles/classic-350/landing/classic-350-motorcycle.png"
                  alt="Royal Enfield Bullet 350"
                  className="w-16 h-12 object-contain"
                  onError={(e) => {
                    e.currentTarget.src = "https://placehold.co/100x60/222/FFF?text=Bullet+350";
                  }}
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[#E5A93C] font-bold uppercase tracking-wider text-[9px]">
                  Sponsored
                </span>
                <span className="text-slate-200 text-[11px] leading-tight pr-1">
                  Explore genuine Royal Enfield Bullet accessories &rarr;
                </span>
              </div>
            </a>
          )}
          {showAvatarOverlay && (
            <AvatarOverlay
              persona={persona}
              voiceGender={voiceGender}
              state={avatarState}
              readMouthFrame={readMouthFrame}
            />
          )}
        </div>
      </div>

      <footer className="border-t border-white/10 px-5 py-3">
        <p className="text-xs text-slate-500">
          Visual director →{" "}
          <span className="font-mono text-indigo-300">{lesson.visual_director.mode}</span>
        </p>
        <p className="mt-1 text-xs text-slate-400">{lesson.visual_director.caption}</p>
      </footer>
    </section>
  );
}

function EmptyStageState({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
      {message}
    </div>
  );
}
