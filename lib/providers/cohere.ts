import "server-only";
import { CohereClientV2 } from "cohere-ai";
import { LESSON_JSON_SCHEMA } from "./lesson-schema";
import { containsCanary } from "@/lib/security/canary";
import { ProviderError, toProviderError, type LessonProvider } from "./shared";

let client: CohereClientV2 | null = null;

function getClient(): CohereClientV2 {
  const token = process.env.COHERE_API_KEY;
  if (!token) {
    throw new ProviderError("not_configured", "cohere", "COHERE_API_KEY is not set.");
  }
  if (!client) client = new CohereClientV2({ token });
  return client;
}

export function isCohereConfigured(): boolean {
  return Boolean(process.env.COHERE_API_KEY);
}

export const generateWithCohere: LessonProvider = async (request) => {
  const cohere = getClient();

  try {
    const stream = await cohere.chatStream({
      model: request.model.modelName,
      messages: [
        { role: "system", content: request.systemInstruction },
        ...request.messages.map((message) =>
          message.role === "assistant"
            ? ({ role: "assistant", content: message.content } as const)
            : ({ role: "user", content: message.content } as const),
        ),
      ],
      // Cohere's own docs warn that json_object without a schema can run away
      // generating characters until it exhausts the context, so the schema is
      // always supplied rather than left to chance.
      responseFormat: {
        type: "json_object",
        jsonSchema: LESSON_JSON_SCHEMA,
      },
      temperature: 0.6,
      maxTokens: 4096,
    });

    // Streamed rather than awaited whole: the canary check below needs to see
    // the text as it arrives so a leak is caught (and the connection dropped)
    // mid-generation, not after the model has already finished writing it.
    let text = "";
    for await (const event of stream) {
      if (event.type === "content-delta") {
        text += event.delta?.message?.content?.text ?? "";
        if (containsCanary(text, request.canaryToken)) {
          // `break` closes the SSE stream this iterates over — a real abort,
          // not just a local stop-reading.
          throw new ProviderError(
            "canary_triggered",
            "cohere",
            "Cohere reflected the system-prompt canary token back in its output.",
          );
        }
      }
    }

    if (!text.trim()) {
      throw new ProviderError("bad_response", "cohere", "Cohere returned an empty message.");
    }
    return { text: text.trim() };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw toProviderError("cohere", error);
  }
};
