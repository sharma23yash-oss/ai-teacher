import "server-only";
import { CohereClientV2 } from "cohere-ai";
import { LESSON_JSON_SCHEMA } from "./lesson-schema";
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
    const response = await cohere.chat({
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

    // v2 returns assistant content as an array of typed blocks.
    const text = (response.message?.content ?? [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    if (!text) {
      throw new ProviderError("bad_response", "cohere", "Cohere returned an empty message.");
    }
    return { text };
  } catch (error) {
    throw toProviderError("cohere", error);
  }
};
