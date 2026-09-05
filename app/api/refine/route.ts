import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { isGeminiConfigured } from "@/lib/providers/gemini";
import { isGroqConfigured } from "@/lib/providers/groq";
import type { RefinePromptResponseBody } from "@/lib/types";

export const runtime = "nodejs";

const MAX_RAW_PROMPT_CHARS = 2000;

// Hard latency budget for this endpoint: a short, capped rewrite, not a
// teaching turn. No history, no lesson state, no thinking/reasoning budget —
// just { rawPrompt } in, one short sentence out.
const MAX_OUTPUT_TOKENS = 120;
const TEMPERATURE = 0.4;

// Same instruction regardless of which provider ends up serving the request —
// only the rewrite quality should vary, never the goal. Deliberately terse:
// a long instruction costs prompt-processing time on every single call.
const REFINER_SYSTEM_INSTRUCTION =
  "You are a prompt refiner. Convert the user's short query into a clear, targeted educational question in 1 or 2 sentences max. Output ONLY the refined prompt, no introductory text, no quotes, no explanations.";

// Groq retired llama-3.1-8b-instant (404s as of this writing — confirmed
// against GET /openai/v1/models, which no longer lists any Llama 3.x text
// model). Of what Groq actually serves today, qwen/qwen3.8-27b is the
// fastest model that isn't a reasoning model: openai/gpt-oss-20b/120b always
// emit a hidden reasoning trace before content (eating into MAX_OUTPUT_TOKENS
// and adding latency) and qwen/qwen3.6-27b does the same via visible <think>
// tags — both are exactly the "thinking/reasoning budget" this endpoint
// needs to avoid. qwen3.8-27b answers directly, no reasoning field, no
// <think> tags, ~700ms end-to-end in testing.
const GROQ_REFINE_MODEL = "qwen/qwen3.8-27b";

// Gemini retired the 2.5-* line for new API keys (its own 404 names
// gemini-3.5-flash-lite as the successor) — same flash-lite tier already
// used elsewhere in this app specifically because it has no thinking budget
// to disable in the first place.
const GEMINI_REFINE_MODEL = "gemini-3.5-flash-lite";

let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return geminiClient;
}

// See lib/providers/groq.ts for why this must stay bare — groq-sdk already
// bakes "/openai/v1" into every endpoint path, so appending it here doubles
// the path and 404s.
let groqClient: Groq | null = null;
function getGroqClient(): Groq {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com" });
  }
  return groqClient;
}

async function refineWithGemini(rawPrompt: string): Promise<string> {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: GEMINI_REFINE_MODEL,
    contents: [{ role: "user", parts: [{ text: rawPrompt }] }],
    config: {
      systemInstruction: REFINER_SYSTEM_INSTRUCTION,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: TEMPERATURE,
      // flash-lite has no thinking budget to disable — nothing to set here.
    },
  });
  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned an empty refinement.");
  return text;
}

async function refineWithGroq(rawPrompt: string): Promise<string> {
  const groq = getGroqClient();
  const completion = await groq.chat.completions.create({
    model: GROQ_REFINE_MODEL,
    messages: [
      { role: "system", content: REFINER_SYSTEM_INSTRUCTION },
      { role: "user", content: rawPrompt },
    ],
    temperature: TEMPERATURE,
    max_completion_tokens: MAX_OUTPUT_TOKENS,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned an empty refinement.");
  return text;
}

export async function POST(request: Request) {
  if (!isGeminiConfigured() && !isGroqConfigured()) {
    return NextResponse.json<RefinePromptResponseBody>(
      {
        ok: false,
        error: "No AI provider is configured. Set GEMINI_API_KEY or GROQ_API_KEY in .env.local.",
      },
      { status: 500 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json<RefinePromptResponseBody>(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof rawBody !== "object" || rawBody === null) {
    return NextResponse.json<RefinePromptResponseBody>(
      { ok: false, error: "Expected { rawPrompt: string }." },
      { status: 400 },
    );
  }
  const { rawPrompt } = rawBody as Record<string, unknown>;
  if (typeof rawPrompt !== "string" || !rawPrompt.trim()) {
    return NextResponse.json<RefinePromptResponseBody>(
      { ok: false, error: "Expected { rawPrompt: string }." },
      { status: 400 },
    );
  }

  const truncated = rawPrompt.trim().slice(0, MAX_RAW_PROMPT_CHARS);
  // Groq first: it's the low-latency target for this endpoint. Gemini is
  // strictly the fallback for when Groq is unconfigured or errors.
  const preferGroq = isGroqConfigured();

  try {
    const refinedPrompt = preferGroq
      ? await refineWithGroq(truncated)
      : await refineWithGemini(truncated);
    return NextResponse.json<RefinePromptResponseBody>({ ok: true, refinedPrompt });
  } catch (error) {
    // Groq was tried first because it's configured — give Gemini one shot
    // before giving up, if it's also available.
    if (preferGroq && isGeminiConfigured()) {
      try {
        const refinedPrompt = await refineWithGemini(truncated);
        return NextResponse.json<RefinePromptResponseBody>({ ok: true, refinedPrompt });
      } catch (fallbackError) {
        console.error(
          "Unexpected /api/refine error (both providers failed):",
          error,
          fallbackError,
        );
        return NextResponse.json<RefinePromptResponseBody>(
          { ok: false, error: "Couldn't refine that prompt right now — please try again." },
          { status: 502 },
        );
      }
    }
    console.error("Unexpected /api/refine error:", error);
    return NextResponse.json<RefinePromptResponseBody>(
      { ok: false, error: "Couldn't refine that prompt right now — please try again." },
      { status: 502 },
    );
  }
}
