import "server-only";
import type { AiProvider, TeacherModel } from "@/lib/types";

/** Provider-neutral conversation turn. Each adapter maps this to its own wire format. */
export interface NeutralMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderRequest {
  model: TeacherModel;
  systemInstruction: string;
  messages: NeutralMessage[];
  /** Base64 JPEG, no data: prefix. Only passed to models with supportsVision. */
  webcamFrame?: string;
  extendedThinking: boolean;
}

export interface ProviderResponse {
  /** Raw model output, expected to be a JSON object matching the lesson schema. */
  text: string;
}

export type LessonProvider = (request: ProviderRequest) => Promise<ProviderResponse>;

/**
 * Why a provider call failed, in terms the failover orchestrator can act on.
 *   not_configured — no API key on the server; skip this provider entirely.
 *   auth           — key present but rejected; skip, and worth telling the dev.
 *   rate_limit     — quota or RPM exhausted; try the next provider.
 *   unavailable    — 5xx, timeout, network; try the next provider.
 *   bad_response   — reached the model but the output wasn't a usable lesson.
 *   bad_request    — our own payload was rejected; failing over won't help.
 */
export type ProviderFailureKind =
  | "not_configured"
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "bad_response"
  | "bad_request";

export class ProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly provider: AiProvider;
  readonly status?: number;

  constructor(
    kind: ProviderFailureKind,
    provider: AiProvider,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.provider = provider;
    this.status = status;
  }

  /** Whether trying a different model/provider could still serve this turn. */
  get shouldFailOver(): boolean {
    return (
      this.kind === "not_configured" ||
      this.kind === "auth" ||
      this.kind === "rate_limit" ||
      this.kind === "unavailable" ||
      this.kind === "bad_response"
    );
  }
}

/** Normalises the assorted error shapes the three SDKs throw. */
export function toProviderError(provider: AiProvider, error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  const status = readStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return new ProviderError("auth", provider, `Authentication rejected: ${message}`, status);
  }
  if (status === 429) {
    return new ProviderError("rate_limit", provider, `Rate limited: ${message}`, status);
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError("bad_request", provider, message, status);
  }
  if (typeof status === "number" && status >= 500) {
    return new ProviderError("unavailable", provider, `Upstream error: ${message}`, status);
  }
  // Quota messages don't always carry a 429 — Gemini in particular reports
  // exhaustion in the message body of an otherwise unremarkable error.
  if (/quota|rate.?limit|exhausted|too many requests/i.test(message)) {
    return new ProviderError("rate_limit", provider, message, status);
  }
  return new ProviderError("unavailable", provider, message, status);
}

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.status === "number") return record.status;
  if (typeof record.statusCode === "number") return record.statusCode;
  const response = record.response;
  if (typeof response === "object" && response !== null) {
    const nested = (response as Record<string, unknown>).status;
    if (typeof nested === "number") return nested;
  }
  return undefined;
}
