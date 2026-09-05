import { NextResponse } from "next/server";
import { buildSystemInstruction, buildTurns } from "@/lib/pedagogy-engine";
import { getDocument, leadingContext, retrieve } from "@/lib/rag/store";
import {
  AllProvidersFailedError,
  generateLessonWithFailover,
  ProviderError,
} from "@/lib/providers";
import {
  GESTURE_SIGNALS,
  isTeacherModelId,
  LANGUAGES,
  LEARNER_LEVELS,
  TEACH_MODES,
  TEACHER_MODELS,
  TEACHER_PERSONAS,
  TIME_BUDGETS,
  type ChatMessage,
  type ConceptNode,
  type ConceptStatus,
  type GestureSignal,
  type Language,
  type LearnerLevel,
  type LessonState,
  type RetrievedChunk,
  type StudentProfile,
  type TeachAction,
  type TeacherModel,
  type TeacherPersona,
  type TeachingPhase,
  type TeachMode,
  type TeachRequestBody,
  type TeachResponseBody,
  type TimeBudget,
} from "@/lib/types";

const CONCEPT_STATUSES: readonly ConceptStatus[] = [
  "completed",
  "current",
  "misconception",
  "locked",
];

const TEACHING_PHASES: readonly TeachingPhase[] = [
  "introduction",
  "explanation",
  "assessment",
  "scaffolding",
];

// ~3.75MB decoded — comfortably above a single webcam JPEG snapshot, just a
// guard against an oversized or malformed payload.
const MAX_WEBCAM_FRAME_BASE64_CHARS = 5_000_000;

export const runtime = "nodejs";

function isChatMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    (v.role === "student" || v.role === "teacher") &&
    typeof v.content === "string"
  );
}

function isTeacherPersona(value: unknown): value is TeacherPersona {
  return typeof value === "string" && (TEACHER_PERSONAS as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function isTimeBudget(value: unknown): value is TimeBudget {
  return typeof value === "string" && (TIME_BUDGETS as readonly string[]).includes(value);
}

function isLearnerLevel(value: unknown): value is LearnerLevel {
  return typeof value === "string" && (LEARNER_LEVELS as readonly string[]).includes(value);
}

function isTeachAction(value: unknown): value is TeachAction {
  return value === "teach" || value === "take_quiz";
}

function isTeachMode(value: unknown): value is TeachMode {
  return typeof value === "string" && (TEACH_MODES as readonly string[]).includes(value);
}

function isGestureSignal(value: unknown): value is GestureSignal {
  return typeof value === "string" && (GESTURE_SIGNALS as readonly string[]).includes(value);
}

function isConceptNode(value: unknown): value is ConceptNode {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    (CONCEPT_STATUSES as readonly unknown[]).includes(v.status)
  );
}

function isStudentProfile(value: unknown): value is StudentProfile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.understood_concepts) &&
    v.understood_concepts.every((entry) => typeof entry === "string") &&
    Array.isArray(v.identified_misconceptions) &&
    v.identified_misconceptions.every((entry) => typeof entry === "string")
  );
}

function isLessonState(value: unknown): value is LessonState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (TEACHING_PHASES as readonly unknown[]).includes(v.teaching_phase) &&
    Array.isArray(v.concept_plan) &&
    v.concept_plan.every(isConceptNode) &&
    isStudentProfile(v.student_profile)
  );
}

function parseRequestBody(body: unknown): TeachRequestBody | null {
  if (typeof body !== "object" || body === null) return null;
  const v = body as Record<string, unknown>;
  if (typeof v.message !== "string" || !v.message.trim()) return null;
  if (!Array.isArray(v.history) || !v.history.every(isChatMessage)) return null;
  if (v.uploadedContent !== undefined && typeof v.uploadedContent !== "string") return null;
  if (!isTeacherModelId(v.modelId)) return null;
  if (typeof v.extendedThinking !== "boolean") return null;
  if (!isTeacherPersona(v.persona)) return null;
  if (!isLanguage(v.language)) return null;
  if (!isTimeBudget(v.timeBudget)) return null;
  if (v.learnerLevel !== undefined && !isLearnerLevel(v.learnerLevel)) return null;
  if (v.docId !== undefined && typeof v.docId !== "string") return null;
  if (v.profileBriefing !== undefined && typeof v.profileBriefing !== "string") return null;
  if (v.action !== undefined && !isTeachAction(v.action)) return null;
  if (v.mode !== undefined && !isTeachMode(v.mode)) return null;
  if (
    v.conceptPlan !== undefined &&
    (!Array.isArray(v.conceptPlan) || !v.conceptPlan.every(isConceptNode))
  ) {
    return null;
  }
  if (v.gestureSignal !== undefined && !isGestureSignal(v.gestureSignal)) return null;
  if (v.lessonState !== undefined && !isLessonState(v.lessonState)) return null;
  if (
    v.webcamFrame !== undefined &&
    (typeof v.webcamFrame !== "string" ||
      !v.webcamFrame.trim() ||
      v.webcamFrame.length > MAX_WEBCAM_FRAME_BASE64_CHARS)
  ) {
    return null;
  }

  return {
    history: v.history,
    message: v.message,
    uploadedContent: v.uploadedContent,
    modelId: v.modelId,
    extendedThinking: v.extendedThinking,
    persona: v.persona,
    language: v.language,
    timeBudget: v.timeBudget,
    learnerLevel: v.learnerLevel,
    docId: v.docId,
    profileBriefing: v.profileBriefing,
    action: v.action,
    mode: v.mode,
    conceptPlan: v.conceptPlan,
    webcamFrame: v.webcamFrame,
    gestureSignal: v.gestureSignal,
    lessonState: v.lessonState,
  };
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json<TeachResponseBody>(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const body = parseRequestBody(rawBody);
  if (!body) {
    return NextResponse.json<TeachResponseBody>(
      {
        ok: false,
        error:
          "Expected { history: ChatMessage[], message: string, uploadedContent?: string, modelId: TeacherModelId, extendedThinking: boolean, persona: TeacherPersona, language: Language, timeBudget: TimeBudget, action?: TeachAction, mode?: TeachMode, conceptPlan?: ConceptNode[], webcamFrame?: string, gestureSignal?: GestureSignal, lessonState?: LessonState }.",
      },
      { status: 400 },
    );
  }

  const action: TeachAction = body.action ?? "teach";
  const teachMode: TeachMode = body.mode ?? "socratic";
  const requestedModel = TEACHER_MODELS[body.modelId];

  // ---- Retrieval ---------------------------------------------------------
  // Every turn with a loaded document gets its own retrieval pass, keyed to
  // what the student just said AND to the concept currently being taught.
  // Both halves matter: "why does that happen?" retrieves nothing on its own,
  // but retrieves the right passage once the current concept is mixed in.
  //
  // The whole block is wrapped: retrieval is an enhancement, and a failure in
  // it must degrade the lesson to ungrounded rather than fail the turn.
  let retrieved: RetrievedChunk[] = [];
  let documentName: string | undefined;

  if (body.docId) {
    try {
      const document = getDocument(body.docId);
      if (document) {
        documentName = document.fileName;
        const plannedYet = (body.lessonState?.concept_plan.length ?? 0) > 0;

        if (!plannedYet) {
          // First turn on this document: there is no question to retrieve
          // against yet, and the model needs a wide enough view to build a
          // syllabus rather than five paragraphs matched on "teach me this".
          retrieved = leadingContext(body.docId);
        } else {
          const currentConcept = body.lessonState?.concept_plan.find(
            (concept) => concept.status === "current",
          );
          retrieved = await retrieve(body.docId, {
            query:
              action === "take_quiz"
                ? (body.lessonState?.concept_plan ?? []).map((c) => c.label).join(". ")
                : body.message,
            conceptHint: currentConcept?.label,
            topK: action === "take_quiz" ? 8 : 5,
          });
        }
      }
    } catch (error) {
      console.warn("Retrieval failed; continuing ungrounded:", error);
      retrieved = [];
    }
  }

  const messages = buildTurns({
    history: body.history,
    currentMessage: body.message,
    // Only reaches the prompt when retrieval produced nothing — see buildTurns.
    uploadedContent: body.uploadedContent,
    quizConceptPlan: action === "take_quiz" ? (body.conceptPlan ?? []) : undefined,
    gestureSignal: body.gestureSignal,
    lessonState: body.lessonState,
    retrieved,
    documentName,
    profileBriefing: body.profileBriefing,
  });

  try {
    const { payload, servedBy } = await generateLessonWithFailover({
      requestedModelId: requestedModel.id,
      systemInstruction: "",
      messages,
      webcamFrame: body.webcamFrame,
      extendedThinking: body.extendedThinking,
      lessonState: body.lessonState,
      // Rebuilt per attempt: only vision models are told to read the frame, and
      // only loose-JSON models get the schema spelled out in the prompt.
      buildSystemInstruction: (model: TeacherModel) =>
        buildSystemInstruction(
          body.persona,
          body.language,
          body.timeBudget,
          body.learnerLevel ?? "beginner",
          Boolean(body.webcamFrame) && model.supportsVision,
          model.jsonMode,
          teachMode,
        ),
    });

    return NextResponse.json<TeachResponseBody>({
      ok: true,
      payload,
      servedBy,
      // Surfaced so a grounded answer can be traced to its passages in the UI,
      // and so an ungrounded one is visibly ungrounded.
      groundedOn: retrieved.length > 0 ? retrieved : undefined,
    });
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      const rateLimited = error.failures.every((failure) => failure.kind === "rate_limit");
      return NextResponse.json<TeachResponseBody>(
        {
          ok: false,
          error: rateLimited
            ? "Every configured model is rate limited right now — please try again shortly."
            : "No configured model could answer that turn. Check the server logs for the per-provider reason.",
        },
        { status: rateLimited ? 429 : 502 },
      );
    }

    if (error instanceof ProviderError) {
      if (error.kind === "not_configured") {
        return NextResponse.json<TeachResponseBody>(
          { ok: false, error: error.message },
          { status: 500 },
        );
      }
      if (error.kind === "auth") {
        return NextResponse.json<TeachResponseBody>(
          {
            ok: false,
            error: `${error.provider} rejected the API key. Check the matching key in .env.local and restart the dev server.`,
          },
          { status: 500 },
        );
      }
      return NextResponse.json<TeachResponseBody>(
        { ok: false, error: `Teaching engine error: ${error.message}` },
        { status: 502 },
      );
    }

    console.error("Unexpected /api/teach error:", error);
    return NextResponse.json<TeachResponseBody>(
      { ok: false, error: "Unexpected server error." },
      { status: 500 },
    );
  }
}
