import "server-only";
import { ApiError, GoogleGenAI, type Content } from "@google/genai";
import { LESSON_RESPONSE_SCHEMA } from "@/lib/pedagogy-engine";
import { containsCanary } from "@/lib/security/canary";
import { ProviderError, toProviderError, type LessonProvider } from "./shared";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("not_configured", "gemini", "GEMINI_API_KEY is not set.");
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export const generateWithGemini: LessonProvider = async (request) => {
  const ai = getClient();

  const contents: Content[] = request.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));

  // The snapshot belongs to the turn the student just took, so it rides on the
  // final user message rather than being appended as a turn of its own.
  const lastIndex = contents.length - 1;
  if (request.webcamFrame && lastIndex >= 0 && contents[lastIndex].role === "user") {
    contents[lastIndex] = {
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: request.webcamFrame } },
        ...(contents[lastIndex].parts ?? []),
      ],
    };
  }

  try {
    const stream = await ai.models.generateContentStream({
      model: request.model.modelName,
      contents,
      config: {
        systemInstruction: request.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: LESSON_RESPONSE_SCHEMA,
        // This model generation rejects `thinkingBudget: 0` with a 400, so
        // "off" means omitting thinkingConfig entirely.
        ...(request.extendedThinking && request.model.supportsThinking
          ? { thinkingConfig: { thinkingBudget: 2048 } }
          : {}),
      },
    });

    // Streamed rather than awaited whole: the canary check below needs to see
    // the text as it arrives so a leak is caught (and the connection dropped)
    // mid-generation, not after the model has already finished writing it.
    let text = "";
    for await (const chunk of stream) {
      text += chunk.text ?? "";
      if (containsCanary(text, request.canaryToken)) {
        // `break` closes the async generator (calls its `.return()`), which
        // ends the underlying HTTP stream — this is a real abort, not just a
        // local stop-reading.
        throw new ProviderError(
          "canary_triggered",
          "gemini",
          "Gemini reflected the system-prompt canary token back in its output.",
        );
      }
    }

    if (!text) {
      throw new ProviderError(
        "bad_response",
        "gemini",
        "Gemini returned no structured response.",
      );
    }
    return { text };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof ApiError) {
      throw toProviderError("gemini", { status: error.status, message: error.message });
    }
    throw toProviderError("gemini", error);
  }
};
