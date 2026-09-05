import "server-only";
import Groq from "groq-sdk";
import { LESSON_JSON_SCHEMA } from "./lesson-schema";
import { ProviderError, toProviderError, type LessonProvider } from "./shared";

let client: Groq | null = null;

// Explicit rather than relying on the SDK default so a stray OPENAI_BASE_URL
// (or a copy-pasted GROQ_BASE_URL) in the environment can't silently redirect
// this client at OpenAI's servers. Do NOT append "/openai/v1" here — groq-sdk
// already bakes that prefix into every endpoint path (verified against
// node_modules/groq-sdk/resources/chat/completions.js), so appending it here
// doubles the path and 404s ("/openai/v1/openai/v1/chat/completions").
const GROQ_BASE_URL = "https://api.groq.com";

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new ProviderError("not_configured", "groq", "GROQ_API_KEY is not set.");
  }
  if (!client) client = new Groq({ apiKey, baseURL: GROQ_BASE_URL });
  return client;
}

export function isGroqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export const generateWithGroq: LessonProvider = async (request) => {
  const groq = getClient();

  try {
    const completion = await groq.chat.completions.create({
      model: request.model.modelName,
      messages: [
        { role: "system", content: request.systemInstruction },
        ...request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ],
      // Groq only enforces a schema on its GPT-OSS and Qwen models. Llama is
      // limited to json_object, which guarantees parseable JSON but not our
      // shape — lesson-schema.ts repairs the difference.
      response_format:
        request.model.jsonMode === "schema"
          ? {
              type: "json_schema",
              json_schema: {
                name: "lesson_payload",
                strict: true,
                schema: LESSON_JSON_SCHEMA,
              },
            }
          : { type: "json_object" },
      temperature: 0.6,
      max_completion_tokens: 4096,
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      throw new ProviderError("bad_response", "groq", "Groq returned an empty message.");
    }
    return { text };
  } catch (error) {
    throw toProviderError("groq", error);
  }
};
