"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import {
  FEYNMAN_MASTERED_TOKEN,
  GESTURE_SIGNAL_META,
  type ChatMessage,
  type ConceptNode,
  type GestureSignal,
  type Language,
  type LessonPayload,
  type LessonState,
  type QuizReport,
  type TeachAction,
  type TeacherModelId,
  type TeacherPersona,
  type TeachMode,
  type TeachResponseBody,
  type TimeBudget,
  type UploadResponseBody,
  type VideoRefCallback,
  type VoiceGender,
} from "@/lib/types";
import { initialLessonPayload } from "@/lib/initial-lesson";
import { useNarrator } from "@/lib/use-narrator";
import { useGestureRecognition } from "@/lib/use-gesture-recognition";
import type { AvatarState } from "./stage/avatar-face";
import { StagePanel } from "./stage/stage-panel";
import { BrainPanel } from "./brain/brain-panel";

interface UploadedNote {
  fileName: string;
  text: string;
}

// Short spoken reactions after each quiz question — flavored per persona to
// match the voice Gemini writes avatar_script in, since this text never goes
// through the model itself. Punctuated for the same TTS breathing pauses the
// engine is instructed to use.
const QUIZ_FEEDBACK: Record<TeacherPersona, { correct: string; incorrect: string }> = {
  standard: {
    correct: "Correct. Nicely done — that's exactly the right reasoning.",
    incorrect: "Not quite. Have a look at the explanation below, and try the next one.",
  },
  srk: {
    correct: "Waah! Picture perfect, my friend. Absolutely picture perfect.",
    incorrect: "Arre yaar, not this time. But every hero stumbles, before the climax.",
  },
  amitabh: {
    correct: "Correct answer. Shandaar — you have earned full marks for this one.",
    incorrect: "Galat jawaab. But do not lose heart. Read the explanation, carefully.",
  },
  rancho: {
    correct: "Bindaas! You nailed it — all is well, my friend.",
    incorrect: "All is well, don't stress. Let's see where the mix up happened.",
  },
};

function buildQuizSummarySpeech(report: QuizReport): string {
  const parts = [`Great effort. You scored ${report.scorePercent} percent.`];
  if (report.masteredConcepts.length > 0) {
    parts.push(`You've mastered ${report.masteredConcepts.join(", ")}.`);
  }
  if (report.weakConcepts.length > 0) {
    parts.push(`Let's revisit ${report.weakConcepts.join(", ")}, a bit more.`);
  }
  parts.push(report.recommendation);
  return parts.join(" ");
}

// Feynman Mode is instructed to leave concept_plan untouched (see
// FEYNMAN_SYSTEM_PROMPT) and let the client promote it on mastery instead —
// but the model doesn't always obey that (observed it flip the target
// concept to "misconception" mid-session), so promotion is keyed by the id
// captured client-side when the session started, never by re-deriving
// "whichever concept is current" from the model's own response. Mirrors the
// exact promotion rule the normal teaching loop already uses server-side.
function promoteConceptToCompleted(conceptPlan: ConceptNode[], conceptId: string): ConceptNode[] {
  const index = conceptPlan.findIndex((concept) => concept.id === conceptId);
  if (index === -1) return conceptPlan;
  return conceptPlan.map((concept, i) => {
    if (i === index) return { ...concept, status: "completed" };
    if (i === index + 1 && concept.status === "locked") {
      return { ...concept, status: "current" };
    }
    return concept;
  });
}

interface TeachTurnInput {
  /** What the student sees as their own turn in the chat transcript. */
  displayMessage: string;
  /** What the engine receives as the student's message. */
  engineMessage: string;
  action?: TeachAction;
  conceptPlan?: ConceptNode[];
  gestureSignal?: GestureSignal;
  includeUpload?: boolean;
  /** Explicit override — falls back to isFeynmanMode when omitted, since a
   * toggle-on trigger fires in the same event as setIsFeynmanMode(true) and
   * can't rely on that state having re-rendered yet. */
  mode?: TeachMode;
}

export function Dashboard() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lesson, setLesson] = useState<LessonPayload>(initialLessonPayload);
  const [isThinking, setIsThinking] = useState(false);
  const [isTakingQuiz, setIsTakingQuiz] = useState(false);

  // Reverse Socratic (Feynman Crucible) Mode: the AI plays a confused student
  // about whichever concept is "current", and the human explains it back.
  const [isFeynmanMode, setIsFeynmanMode] = useState(false);
  // The concept id the current Feynman session targets, captured once at
  // toggle-on time — see promoteConceptToCompleted for why this, and not the
  // model's own concept_plan, is the source of truth for which one to
  // promote on mastery.
  const [feynmanConceptId, setFeynmanConceptId] = useState<string | null>(null);
  // Concept id to flash a mastery-ping on, cleared a couple seconds later —
  // see the gesture-pop animation in app/globals.css (same 2.6s duration).
  const [celebratingConceptId, setCelebratingConceptId] = useState<string | null>(null);

  const [uploadedNote, setUploadedNote] = useState<UploadedNote | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [model, setModel] = useState<TeacherModelId>("gemini-3.6-flash");
  const [extendedThinking, setExtendedThinking] = useState(false);
  const [persona, setPersona] = useState<TeacherPersona>("standard");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("male");
  const [language, setLanguage] = useState<Language>("english");
  const [timeBudget, setTimeBudget] = useState<TimeBudget>("standard");

  const [isMicListening, setIsMicListening] = useState(false);

  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const [videoCallError, setVideoCallError] = useState<string | null>(null);

  const narrator = useNarrator();

  // One <video> element is shared between the full-stage call and the
  // picture-in-picture preview, and only one of them is mounted at a time. A
  // callback ref re-attaches the live MediaStream whichever one React mounts,
  // which a plain RefObject would not do on a mode switch.
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const attachVideoElement = useCallback<VideoRefCallback>((element) => {
    videoElementRef.current = element;
    if (element && element.srcObject !== streamRef.current) {
      element.srcObject = streamRef.current;
    }
  }, []);

  // Latest values for callbacks that must not be re-created every render (the
  // gesture engine would otherwise tear down and re-load its models).
  const turnStateRef = useRef({ isThinking, isTakingQuiz });
  useLayoutEffect(() => {
    turnStateRef.current = { isThinking, isTakingQuiz };
  }, [isThinking, isTakingQuiz]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
    }
  }, []);

  // Camera teardown only. The narrator is NOT stopped here on purpose:
  // useNarrator() returns a fresh object on every status change, so depending
  // on it made React run this cleanup the instant speaking began — cancelling
  // the very utterance that had just started, which is why replies used to
  // arrive silently. useNarrator disposes its own instance on unmount, so
  // there is nothing left for this effect to clean up.
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const speak = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      narrator.speak({ text, persona, language, voiceGender });
    },
    [narrator, persona, language, voiceGender],
  );

  // Draws the current webcam frame to the hidden canvas (downscaled to a
  // fixed 640x480 to keep the multimodal payload small and predictable) and
  // returns it as a base64 JPEG (no "data:image/jpeg;base64," prefix) for the
  // request body. Returns undefined whenever there's no live, ready frame.
  const captureWebcamFrame = useCallback((): string | undefined => {
    if (!isVideoCallActive) return undefined;
    const video = videoElementRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < video.HAVE_CURRENT_DATA || !video.videoWidth) {
      return undefined;
    }

    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
  }, [isVideoCallActive]);

  const runTeachTurn = useCallback(
    async ({
      displayMessage,
      engineMessage,
      action,
      conceptPlan,
      gestureSignal,
      includeUpload = false,
      mode,
    }: TeachTurnInput) => {
      const historyBeforeThisTurn = messages;
      const studentMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "student",
        content: displayMessage,
      };
      setMessages((prev) => [...prev, studentMessage]);

      const isQuizTurn = action === "take_quiz";
      if (isQuizTurn) setIsTakingQuiz(true);
      else setIsThinking(true);

      const webcamFrame = captureWebcamFrame();
      const effectiveMode: TeachMode = mode ?? (isFeynmanMode ? "feynman" : "socratic");
      // Replayed into the prompt on every turn: whichever provider ends up
      // serving this request resumes this exact concept plan instead of
      // starting the topic over.
      const lessonState: LessonState = {
        teaching_phase: lesson.teaching_phase,
        concept_plan: lesson.concept_plan,
        student_profile: lesson.student_profile,
      };

      try {
        const res = await fetch("/api/teach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            history: historyBeforeThisTurn,
            message: engineMessage,
            uploadedContent: includeUpload ? uploadedNote?.text : undefined,
            modelId: model,
            extendedThinking,
            persona,
            language,
            timeBudget,
            action,
            mode: effectiveMode,
            conceptPlan,
            webcamFrame,
            gestureSignal,
            lessonState,
          }),
        });
        const data = (await res.json()) as TeachResponseBody;
        if (!data.ok) throw new Error(data.error);

        // Feynman Mode: the model appends this marker to avatar_script the
        // turn it concedes its misconception is resolved, and is instructed
        // to leave concept_plan untouched (see FEYNMAN_SYSTEM_PROMPT) — the
        // promotion to "completed" is this client's job, triggered by the
        // marker rather than by any schema-level status the model sets.
        const mastered = data.payload.avatar_script.includes(FEYNMAN_MASTERED_TOKEN);
        const cleanedScript = data.payload.avatar_script
          .split(FEYNMAN_MASTERED_TOKEN)
          .join("")
          .trim();
        const payload: LessonPayload =
          mastered && feynmanConceptId
            ? {
                ...data.payload,
                avatar_script: cleanedScript,
                concept_plan: promoteConceptToCompleted(data.payload.concept_plan, feynmanConceptId),
              }
            : { ...data.payload, avatar_script: cleanedScript };

        const teacherMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "teacher",
          content: cleanedScript,
        };
        setMessages((prev) => [...prev, teacherMessage]);
        setLesson(payload);
        speak(cleanedScript);

        if (mastered && feynmanConceptId) {
          setCelebratingConceptId(feynmanConceptId);
          // The reverse session for this concept is done — hand control back
          // to the normal teaching loop for whatever comes next.
          setIsFeynmanMode(false);
          setFeynmanConceptId(null);
        }

        if (includeUpload) {
          // The uploaded material has now been folded into the lesson's
          // concept plan — no need to keep resending it on every future turn.
          setUploadedNote(null);
        }
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "teacher",
          content:
            error instanceof Error
              ? `Sorry, I hit an error: ${error.message}`
              : "Sorry, something went wrong reaching the teaching engine.",
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        if (isQuizTurn) setIsTakingQuiz(false);
        else setIsThinking(false);
      }
    },
    [
      messages,
      uploadedNote,
      model,
      extendedThinking,
      persona,
      language,
      timeBudget,
      speak,
      captureWebcamFrame,
      lesson,
      isFeynmanMode,
      feynmanConceptId,
    ],
  );

  // Auto-clears the mastery-ping a couple seconds after it fires — matches
  // the 2.6s .gesture-pop animation duration in app/globals.css.
  useEffect(() => {
    if (!celebratingConceptId) return;
    const timer = setTimeout(() => setCelebratingConceptId(null), 2600);
    return () => clearTimeout(timer);
  }, [celebratingConceptId]);

  const handleGestureSignal = useCallback(
    (signal: GestureSignal) => {
      const { isThinking: thinking, isTakingQuiz: quizzing } = turnStateRef.current;
      if (thinking || quizzing) return;
      const meta = GESTURE_SIGNAL_META[signal];
      void runTeachTurn({
        displayMessage: `${meta.glyph} ${meta.meaning}`,
        engineMessage: meta.meaning,
        gestureSignal: signal,
      });
    },
    [runTeachTurn],
  );

  const gesture = useGestureRecognition({
    videoRef: videoElementRef,
    enabled: isVideoCallActive,
    paused: isThinking || isTakingQuiz || narrator.isSpeaking,
    onSignal: handleGestureSignal,
  });

  async function handleToggleVideoCall() {
    // Camera and audio are unlocked together: the student is one click away
    // from hearing the teacher respond to a gesture.
    narrator.unlock();

    if (isVideoCallActive) {
      stopCamera();
      setIsVideoCallActive(false);
      return;
    }

    setVideoCallError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setVideoCallError("Camera access isn't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoElementRef.current) {
        videoElementRef.current.srcObject = stream;
      }
      setIsVideoCallActive(true);
    } catch (error) {
      setVideoCallError(
        error instanceof DOMException &&
          (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
          ? "Camera access was denied. Allow camera permissions to start a video call."
          : "Couldn't access the camera. Check that it's connected and not in use elsewhere.",
      );
    }
  }

  function handleSend(content: string) {
    // Unlocking here — synchronously, inside the click/submit handler and
    // before any await — is what keeps playback legal once Gemini and Edge TTS
    // have finished and the original gesture has long since expired.
    narrator.unlock();
    void runTeachTurn({
      displayMessage: content,
      engineMessage: content,
      includeUpload: true,
    });
  }

  function handleTakeQuiz() {
    narrator.unlock();
    void runTeachTurn({
      displayMessage: "📝 Take Quiz / Assessment",
      engineMessage: "I'd like to take a quiz on what we've covered so far.",
      action: "take_quiz",
      conceptPlan: lesson.concept_plan,
    });
  }

  function handleToggleFeynmanMode() {
    if (isFeynmanMode) {
      setIsFeynmanMode(false);
      setFeynmanConceptId(null);
      return;
    }

    const currentConcept = lesson.concept_plan.find((concept) => concept.status === "current");
    if (!currentConcept) return;

    narrator.unlock();
    setIsFeynmanMode(true);
    setFeynmanConceptId(currentConcept.id);
    // Explicit mode: "feynman" here rather than relying on isFeynmanMode —
    // setIsFeynmanMode(true) above hasn't re-rendered yet, so runTeachTurn's
    // own closure would still see the old (false) value for this one call.
    void runTeachTurn({
      displayMessage: `🧪 Feynman Mode: teach me "${currentConcept.label}"`,
      engineMessage: `I want to try Reverse Socratic (Feynman Crucible) Mode. Play a student with a plausible misconception about "${currentConcept.label}", and let me explain it back to you.`,
      mode: "feynman",
    });
  }

  function handleQuizAnswered(correct: boolean) {
    const feedback = QUIZ_FEEDBACK[persona];
    speak(correct ? feedback.correct : feedback.incorrect);
  }

  function handleQuizCompleted(report: QuizReport) {
    const summary = buildQuizSummarySpeech(report);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "teacher", content: summary },
    ]);
    speak(summary);
  }

  async function handleUpload(file: File) {
    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = (await res.json()) as UploadResponseBody;
      if (!data.ok) throw new Error(data.error);
      setUploadedNote({ fileName: data.fileName, text: data.text });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload that file.");
    } finally {
      setIsUploading(false);
    }
  }

  const avatarState: AvatarState = narrator.isSpeaking
    ? "talking"
    : isMicListening
      ? "listening"
      : "idle";

  const canToggleFeynmanMode = lesson.concept_plan.some((concept) => concept.status === "current");

  return (
    <div className="flex h-dvh flex-col bg-slate-950">
      <header className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
        <GraduationCap size={20} className="text-indigo-400" />
        <span className="text-sm font-semibold text-slate-100">AI Teacher</span>
        <span className="text-xs text-slate-500">— live prototype</span>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        <div className="min-h-0">
          <StagePanel
            isFeynmanMode={isFeynmanMode}
            onToggleFeynmanMode={handleToggleFeynmanMode}
            canToggleFeynmanMode={canToggleFeynmanMode}
            lesson={lesson}
            uploadedFileName={uploadedNote?.fileName ?? null}
            isUploading={isUploading}
            uploadError={uploadError}
            onUpload={handleUpload}
            onClearUpload={() => setUploadedNote(null)}
            model={model}
            onModelChange={setModel}
            extendedThinking={extendedThinking}
            onExtendedThinkingChange={setExtendedThinking}
            persona={persona}
            onPersonaChange={setPersona}
            voiceGender={voiceGender}
            onVoiceGenderChange={setVoiceGender}
            language={language}
            onLanguageChange={setLanguage}
            timeBudget={timeBudget}
            onTimeBudgetChange={setTimeBudget}
            avatarState={avatarState}
            readMouthFrame={narrator.readMouthFrame}
            isAudioBlocked={narrator.isBlocked}
            onReplayAudio={narrator.replayLast}
            onTakeQuiz={handleTakeQuiz}
            isQuizLoading={isTakingQuiz || isThinking}
            onQuizAnswered={handleQuizAnswered}
            onQuizCompleted={handleQuizCompleted}
            isVideoCallActive={isVideoCallActive}
            onToggleVideoCall={handleToggleVideoCall}
            videoCallError={videoCallError}
            attachVideoElement={attachVideoElement}
            gestureStatus={gesture.status}
            gestureError={gesture.error}
            isGestureTracking={gesture.isTracking}
            rawGesture={gesture.rawGesture}
            headPose={gesture.headPose}
            lastGestureSignal={gesture.lastSignal}
            lastGestureSignalId={gesture.lastSignalId}
          />
        </div>
        <div className="min-h-0 border-t border-white/10 md:border-t-0 md:border-l">
          <BrainPanel
            concepts={lesson.concept_plan}
            celebratingConceptId={celebratingConceptId}
            messages={messages}
            onSend={handleSend}
            isThinking={isThinking || isTakingQuiz}
            language={language}
            isTeacherSpeaking={narrator.isSpeaking}
            onListeningChange={setIsMicListening}
            onUnlockAudio={narrator.unlock}
          />
        </div>
      </main>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
