import "server-only";
import { ApiError, GoogleGenAI, type Content } from "@google/genai";
import { LESSON_RESPONSE_SCHEMA } from "@/lib/pedagogy-engine";
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
    const response = await ai.models.generateContent({
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

    const text = response.text;
    if (!text) {
      throw new ProviderError(
        "bad_response",
        "gemini",
        "Gemini returned no structured response.",
      );
    }
    return { text };
  } catch (error) {
    if (error instanceof ApiError) {
      throw toProviderError("gemini", { status: error.status, message: error.message });
    }
    throw toProviderError("gemini", error);
  }
};
