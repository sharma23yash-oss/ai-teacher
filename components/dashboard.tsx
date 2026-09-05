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
  type LearnerLevel,
  type LessonPayload,
  type LessonState,
  type LearnerProfileRecord,
  type QuizReport,
  type RetrievedChunk,
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
import {
  buildProfileBriefing,
  clearProfile,
  loadProfile,
  recordLessonProgress,
  recordMastery,
  recordPreferences,
  recordQuizResult,
  saveProfile,
} from "@/lib/learner-profile";
import { useNarrator } from "@/lib/use-narrator";
import { useGestureRecognition } from "@/lib/use-gesture-recognition";
import type { AvatarState } from "./stage/avatar-face";
import { StagePanel } from "./stage/stage-panel";
import { BrainPanel } from "./brain/brain-panel";

interface UploadedNote {
  fileName: string;
  /** Full extracted text — the self-healing fallback if the index is lost. */
  text: string;
  /** Handle for the server-side retrieval index built at upload time. */
  docId: string;
  chunkCount: number;
  retrieval: "embeddings" | "lexical";
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
  /** @deprecated Retrieval now runs on every turn; kept so callers don't churn. */
  includeUpload?: boolean;
  /**
   * Lesson state to send instead of the one in `lesson`. Needed when a turn
   * is fired in the same tick as a setLesson() that hasn't re-rendered yet —
   * the quiz feedback loop demotes concepts and must teach from the demoted
   * plan, not the stale one this closure still holds.
   */
  lessonStateOverride?: LessonState;
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
  // The passages the last turn was actually grounded in. Empty means the
  // answer came from the model's own knowledge, which the UI says out loud.
  const [groundedOn, setGroundedOn] = useState<RetrievedChunk[]>([]);
  /**
   * Whether retrieval served the previous turn. When it did not — the index
   * was dropped by a server restart, say — the next turn re-sends the raw
   * extracted text so the lesson stays grounded instead of quietly starting
   * to improvise. This is what makes the document survive the whole session
   * rather than only its first turn.
   */
  const [groundedLastTurn, setGroundedLastTurn] = useState(false);

  const [model, setModel] = useState<TeacherModelId>("gemini-3.6-flash");
  const [extendedThinking, setExtendedThinking] = useState(false);
  const [persona, setPersona] = useState<TeacherPersona>("standard");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("male");
  const [language, setLanguage] = useState<Language>("english");
  const [timeBudget, setTimeBudget] = useState<TimeBudget>("standard");
  const [learnerLevel, setLearnerLevel] = useState<LearnerLevel>("beginner");

  const [isMicListening, setIsMicListening] = useState(false);

  // The persistent learner profile. Seeded empty so the server and the first
  // client render agree, then hydrated from localStorage in an effect —
  // reading storage during render would produce a hydration mismatch.
  const [profile, setProfile] = useState<LearnerProfileRecord>(() => ({
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    preferredLanguage: "english",
    preferredLevel: "beginner",
    preferredPersona: "standard",
    preferredTimeBudget: "standard",
    topics: [],
    history: [],
  }));
  const [profileLoaded, setProfileLoaded] = useState(false);
  /** What the student asked to learn — the key their history is filed under. */
  const [currentTopic, setCurrentTopic] = useState<string | null>(null);

  const [isVideoCallActive, setIsVideoCallActive] = useState(false);
  const [videoCallError, setVideoCallError] = useState<string | null>(null);

  // Hydrate once, and restore how this student likes to be taught. Their
  // saved settings are the whole point of remembering them, so they are
  // applied rather than merely stored.
  // localStorage cannot be read during render without a hydration mismatch
  // (the server has no storage), so the profile is loaded once after mount.
  // This is the read side of an external system, which is exactly what
  // effects are for — the rule below is tuned for derived state, not this.
  useEffect(() => {
    const stored = loadProfile();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(stored);
    setProfileLoaded(true);
    if (stored.topics.length > 0 || stored.history.length > 0) {
      setLanguage(stored.preferredLanguage);
      setLearnerLevel(stored.preferredLevel);
      setPersona(stored.preferredPersona);
      setTimeBudget(stored.preferredTimeBudget);
    }
  }, []);

  /**
   * Records a preference change and writes it straight to storage.
   *
   * Done here rather than in an effect watching the four values: a preference
   * changes because the student changed it, so the write belongs at the
   * moment of the change, and an effect would also fire on hydration and
   * re-save what it had just loaded.
   */
  const persistPreference = useCallback(
    (patch: Partial<{
      language: Language;
      level: LearnerLevel;
      persona: TeacherPersona;
      timeBudget: TimeBudget;
    }>) => {
      if (!profileLoaded) return;
      setProfile((previous) => {
        const next = recordPreferences(previous, {
          language,
          level: learnerLevel,
          persona,
          timeBudget,
          ...patch,
        });
        saveProfile(next);
        return next;
      });
    },
    [profileLoaded, language, learnerLevel, persona, timeBudget],
  );

  const handleLanguageChange = useCallback(
    (value: Language) => {
      setLanguage(value);
      persistPreference({ language: value });
    },
    [persistPreference],
  );

  const handleLearnerLevelChange = useCallback(
    (value: LearnerLevel) => {
      setLearnerLevel(value);
      persistPreference({ level: value });
    },
    [persistPreference],
  );

  const handlePersonaChange = useCallback(
    (value: TeacherPersona) => {
      setPersona(value);
      persistPreference({ persona: value });
    },
    [persistPreference],
  );

  const handleTimeBudgetChange = useCallback(
    (value: TimeBudget) => {
      setTimeBudget(value);
      persistPreference({ timeBudget: value });
    },
    [persistPreference],
  );

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
      mode,
      lessonStateOverride,
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
      const lessonState: LessonState = lessonStateOverride ?? {
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
            // Sent only when retrieval isn't serving this document, so the
            // normal path stays a handful of relevant passages rather than a
            // whole textbook re-uploaded on every turn.
            uploadedContent:
              uploadedNote && !groundedLastTurn ? uploadedNote.text : undefined,
            docId: uploadedNote?.docId,
            profileBriefing: buildProfileBriefing(profile, currentTopic ?? displayMessage),
            modelId: model,
            extendedThinking,
            persona,
            language,
            timeBudget,
            learnerLevel,
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

        const grounded = data.groundedOn ?? [];
        setGroundedOn(grounded);
        setGroundedLastTurn(grounded.length > 0);

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

        // File what this turn established about the learner. The topic is
        // whatever they first asked for, so a lesson and its later quiz land
        // under the same heading in their history.
        if (payload.concept_plan.length > 0) {
          const isNewTopic = currentTopic === null;
          const topic = currentTopic ?? displayMessage.slice(0, 90);
          if (isNewTopic) setCurrentTopic(topic);
          setProfile((previous) => {
            const next = recordLessonProgress(previous, topic, payload.concept_plan, isNewTopic);
            saveProfile(next);
            return next;
          });
        }

        if (mastered && feynmanConceptId) {
          const masteredLabel = lesson.concept_plan.find(
            (concept) => concept.id === feynmanConceptId,
          )?.label;
          if (masteredLabel && currentTopic) {
            setProfile((previous) => {
              const next = recordMastery(previous, currentTopic, masteredLabel);
              saveProfile(next);
              return next;
            });
          }
          setCelebratingConceptId(feynmanConceptId);
          // The reverse session for this concept is done — hand control back
          // to the normal teaching loop for whatever comes next.
          setIsFeynmanMode(false);
          setFeynmanConceptId(null);
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
      groundedLastTurn,
      learnerLevel,
      profile,
      currentTopic,
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

  /**
   * Closes the assessment loop.
   *
   * A score the student reads and dismisses changes nothing. So the result is
   * written back into the lesson itself: concepts they got wrong drop out of
   * "completed" and back to "misconception", the engine is told about them in
   * student_profile, and the first weak concept is immediately re-taught from
   * a different angle. The quiz becomes the thing that decides what happens
   * next, which is what section 12's adapt-after-evaluate loop actually asks
   * for.
   */
  function handleQuizCompleted(report: QuizReport) {
    const summary = buildQuizSummarySpeech(report);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "teacher", content: summary },
    ]);
    speak(summary);

    if (currentTopic) {
      setProfile((previous) => {
        const next = recordQuizResult(previous, currentTopic, report);
        saveProfile(next);
        return next;
      });
    }

    const weakIds = new Set(report.weakConceptIds);
    const masteredIds = new Set(report.masteredConceptIds);

    if (weakIds.size === 0) {
      // Nothing missed — promote what the quiz confirmed and carry on.
      setLesson((previous) => ({
        ...previous,
        concept_plan: previous.concept_plan.map((concept) =>
          masteredIds.has(concept.id) ? { ...concept, status: "completed" } : concept,
        ),
      }));
      return;
    }

    const repaired = lesson.concept_plan.map((concept) => {
      if (weakIds.has(concept.id)) return { ...concept, status: "misconception" as const };
      if (masteredIds.has(concept.id)) return { ...concept, status: "completed" as const };
      return concept;
    });

    const firstWeak = repaired.find((concept) => weakIds.has(concept.id));

    setLesson((previous) => ({
      ...previous,
      concept_plan: repaired,
      student_profile: {
        understood_concepts: report.masteredConcepts,
        identified_misconceptions: report.weakConcepts,
      },
    }));

    if (!firstWeak) return;

    // Re-teach immediately, using the repaired plan as the state the engine
    // resumes from, so it picks up the demoted concept rather than the stale
    // "completed" one.
    void runTeachTurn({
      displayMessage: `\u{1F4CB} Quiz result: ${report.scorePercent}% — re-teach "${firstWeak.label}"`,
      engineMessage: `I scored ${report.scorePercent}% on the quiz. I got questions wrong on: ${report.weakConcepts.join(", ")}. Re-teach "${firstWeak.label}" from a different angle, using a simpler analogy than before, then ask me one easier check question on it. Do not move on to a new concept yet.`,
      lessonStateOverride: {
        teaching_phase: "scaffolding",
        concept_plan: repaired,
        student_profile: {
          understood_concepts: report.masteredConcepts,
          identified_misconceptions: report.weakConcepts,
        },
      },
    });
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
      setUploadedNote({
        fileName: data.fileName,
        text: data.text,
        docId: data.knowledgeBase.docId,
        chunkCount: data.knowledgeBase.chunkCount,
        retrieval: data.knowledgeBase.retrieval,
      });
      setGroundedLastTurn(false);
      setGroundedOn([]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload that file.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleResetProfile() {
    clearProfile();
    const fresh = loadProfile();
    setProfile(fresh);
    setCurrentTopic(null);
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
        <span className="text-xs text-slate-500">
          Understand → Plan → Explain → Question → Evaluate → Adapt
        </span>
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
            onPersonaChange={handlePersonaChange}
            voiceGender={voiceGender}
            onVoiceGenderChange={setVoiceGender}
            language={language}
            onLanguageChange={handleLanguageChange}
            learnerLevel={learnerLevel}
            onLearnerLevelChange={handleLearnerLevelChange}
            timeBudget={timeBudget}
            onTimeBudgetChange={handleTimeBudgetChange}
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
            profile={profile}
            onResetProfile={handleResetProfile}
            groundedOn={groundedOn}
            documentName={uploadedNote?.fileName ?? null}
          />
        </div>
      </main>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
    </div>
  );
}
