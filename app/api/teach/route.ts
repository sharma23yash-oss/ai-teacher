import { NextResponse } from "next/server";
import { buildSystemInstruction, buildTurns } from "@/lib/pedagogy-engine";
import { getDocument, leadingContext, retrieve } from "@/lib/rag/store";
import {
  AllProvidersFailedError,
  generateLessonWithFailover,
  ProviderError,
} from "@/lib/providers";
import { formatZodError, teachRequestSchema } from "@/lib/schemas";
import {
  TEACHER_MODELS,
  type RetrievedChunk,
  type TeachAction,
  type TeacherModel,
  type TeachMode,
  type TeachRequestBody,
  type TeachResponseBody,
} from "@/lib/types";

export const runtime = "nodejs";

function parseRequestBody(body: unknown): TeachRequestBody | { error: string } {
  const result = teachRequestSchema.safeParse(body);
  if (!result.success) return { error: formatZodError(result.error) };
  return result.data;
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

  const parsed = parseRequestBody(rawBody);
  if ("error" in parsed) {
    return NextResponse.json<TeachResponseBody>({ ok: false, error: parsed.error }, { status: 400 });
  }
  const body = parsed;

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
      buildSystemInstruction: (model: TeacherModel, canaryToken: string) =>
        buildSystemInstruction(
          body.persona,
          body.language,
          body.timeBudget,
          body.learnerLevel ?? "beginner",
          Boolean(body.webcamFrame) && model.supportsVision,
          model.jsonMode,
          teachMode,
          canaryToken,
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
