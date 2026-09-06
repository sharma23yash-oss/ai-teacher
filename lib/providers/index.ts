import "server-only";
import {
  TEACHER_MODELS,
  type AiProvider,
  type LessonPayload,
  type LessonState,
  type ServedBy,
  type TeacherModel,
  type TeacherModelId,
} from "@/lib/types";
import { LessonParseError, parseLessonPayload } from "./lesson-schema";
import {
  ProviderError,
  type LessonProvider,
  type NeutralMessage,
  type ProviderRequest,
} from "./shared";
import { generateWithGemini, isGeminiConfigured } from "./gemini";
import { generateWithGroq, isGroqConfigured } from "./groq";
import { generateWithCohere, isCohereConfigured } from "./cohere";
import { createCanaryToken } from "@/lib/security/canary";
import { sanitizeLessonPayload } from "@/lib/security/sanitize-output";

const PROVIDERS: Record<AiProvider, LessonProvider> = {
  gemini: generateWithGemini,
  groq: generateWithGroq,
  cohere: generateWithCohere,
};

const CONFIGURED_CHECKS: Record<AiProvider, () => boolean> = {
  gemini: isGeminiConfigured,
  groq: isGroqConfigured,
  cohere: isCohereConfigured,
};

// Preferred model per provider when failover picks the provider rather than
// the student. Schema-enforcing models come first: a fallback turn should be
// the least likely to need repairing.
const PROVIDER_PREFERENCE: Record<AiProvider, TeacherModelId[]> = {
  gemini: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview"],
  groq: ["groq-gpt-oss-120b", "groq-qwen3.8-27b", "groq-gpt-oss-20b"],
  cohere: ["cohere-command-a", "cohere-command-r-plus", "cohere-command-r"],
};

const PROVIDER_ORDER: AiProvider[] = ["gemini", "groq", "cohere"];

/** Bounds how long one provider may stall before the next is tried. */
const ATTEMPT_TIMEOUT_MS = 45_000;
/** Caps total latency when several providers are failing at once. */
const MAX_ATTEMPTS = 4;

export function getConfiguredProviders(): AiProvider[] {
  return PROVIDER_ORDER.filter((provider) => CONFIGURED_CHECKS[provider]());
}

/**
 * The requested model first, then one model from each other configured
 * provider, then the remaining models of the requested provider.
 *
 * Other providers come before same-provider alternatives on purpose: a 429 is
 * almost always an account-wide quota, so the next model from the same vendor
 * would fail for exactly the same reason.
 */
export function buildFallbackChain(requested: TeacherModel): TeacherModel[] {
  const configured = new Set(getConfiguredProviders());
  const chain: TeacherModel[] = [];
  const seen = new Set<TeacherModelId>();

  const push = (id: TeacherModelId) => {
    const model = TEACHER_MODELS[id];
    if (seen.has(id) || !configured.has(model.provider)) return;
    seen.add(id);
    chain.push(model);
  };

  if (configured.has(requested.provider)) push(requested.id);

  for (const provider of PROVIDER_ORDER) {
    if (provider === requested.provider) continue;
    const first = PROVIDER_PREFERENCE[provider][0];
    if (first) push(first);
  }

  for (const id of PROVIDER_PREFERENCE[requested.provider]) push(id);

  for (const provider of PROVIDER_ORDER) {
    if (provider === requested.provider) continue;
    for (const id of PROVIDER_PREFERENCE[provider]) push(id);
  }

  return chain.slice(0, MAX_ATTEMPTS);
}

function withTimeout<T>(promise: Promise<T>, provider: AiProvider): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ProviderError(
          "unavailable",
          provider,
          `No response within ${ATTEMPT_TIMEOUT_MS / 1000}s.`,
        ),
      );
    }, ATTEMPT_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface GenerateLessonOptions {
  requestedModelId: TeacherModelId;
  systemInstruction: string;
  messages: NeutralMessage[];
  webcamFrame?: string;
  extendedThinking: boolean;
  lessonState?: LessonState;
  /**
   * Rebuilt per attempt because vision support differs between models. The
   * canary token is generated once per call (see below) and passed in here
   * so every attempt's system instruction carries the same marker.
   */
  buildSystemInstruction: (model: TeacherModel, canaryToken: string) => string;
}

export interface GenerateLessonResult {
  payload: LessonPayload;
  servedBy: ServedBy;
}

export class AllProvidersFailedError extends Error {
  readonly failures: ProviderError[];
  constructor(failures: ProviderError[]) {
    super("Every configured model refused this turn.");
    this.name = "AllProvidersFailedError";
    this.failures = failures;
  }
}

/**
 * Runs the turn against the requested model, falling through to other
 * configured providers on any failure that a different model could plausibly
 * survive (quota, auth, upstream outage, unusable output).
 *
 * The whole lesson state travels in the prompt, so a turn served by a fallback
 * continues the same concept plan rather than starting a new lesson.
 */
export async function generateLessonWithFailover(
  options: GenerateLessonOptions,
): Promise<GenerateLessonResult> {
  const requested = TEACHER_MODELS[options.requestedModelId];
  const chain = buildFallbackChain(requested);

  if (chain.length === 0) {
    throw new ProviderError(
      "not_configured",
      requested.provider,
      "No AI provider is configured. Set at least one of GEMINI_API_KEY, GROQ_API_KEY or COHERE_API_KEY in .env.local.",
    );
  }

  const failures: ProviderError[] = [];
  // One canary per student turn, reused across every attempt in the fallback
  // chain — a leak is a property of the prompt/content for this turn, not of
  // which model happened to be asked.
  const canaryToken = createCanaryToken();

  for (const model of chain) {
    const request: ProviderRequest = {
      model,
      systemInstruction: options.buildSystemInstruction(model, canaryToken),
      messages: options.messages,
      // Only Gemini can read the frame; sending it elsewhere is a 400.
      webcamFrame: model.supportsVision ? options.webcamFrame : undefined,
      extendedThinking: options.extendedThinking,
      canaryToken,
    };

    try {
      const { text } = await withTimeout(PROVIDERS[model.provider](request), model.provider);
      const payload = sanitizeLessonPayload(
        parseLessonPayload(text, options.lessonState),
        request.systemInstruction,
      );
      return {
        payload,
        servedBy: {
          modelId: model.id,
          provider: model.provider,
          label: model.label,
          switched: model.id !== requested.id,
        },
      };
    } catch (error) {
      const failure =
        error instanceof LessonParseError
          ? new ProviderError("bad_response", model.provider, error.message)
          : error instanceof ProviderError
            ? error
            : new ProviderError("unavailable", model.provider, String(error));

      failures.push(failure);
      // Server-side only: the student is never told a switch happened, but the
      // developer needs to be able to see which model actually answered.
      console.warn(
        `[teach] ${model.id} failed (${failure.kind}): ${failure.message}`,
      );

      if (!failure.shouldFailOver) throw failure;
    }
  }

  throw new AllProvidersFailedError(failures);
}

export { ProviderError } from "./shared";
export type { NeutralMessage } from "./shared";
