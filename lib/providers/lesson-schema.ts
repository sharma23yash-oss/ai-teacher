import "server-only";
import type {
  ConceptNode,
  ConceptStatus,
  LessonPayload,
  LessonState,
  QuizQuestion,
  TeachingPhase,
  VisualMode,
} from "@/lib/types";

/**
 * OpenAI-compatible "strict" json_schema mode (Groq and Cohere both implement
 * it) has two hard requirements on every object node — violate either and the
 * API rejects the schema itself with a 400 before any generation happens:
 *   1. `additionalProperties: false` must be set.
 *   2. `required` must list every key in `properties`; there is no way to
 *      mark a property merely optional.
 * Fields that are genuinely optional below (absent from that node's own
 * `required` list, as hand-written) are instead made nullable: the key must
 * always be present, but its value may be `null` when it doesn't apply this
 * turn. parseLessonPayload already treats anything that isn't the expected
 * type — null included — as absent, so no repair-side changes are needed.
 *
 * Exception: Cohere's json_schema validator rejects a `type` list that
 * contains "object" ("type must not be a list that contains `object`"), so an
 * optional object-typed field (only diagram_data, here) stays a plain
 * required object instead of nullable. When it doesn't apply, the model
 * supplies its own empty shape — e.g. `{ nodes: [], edges: [] }` — which its
 * own required/additionalProperties already accept.
 */
function makeNullable(schema: Record<string, unknown>): Record<string, unknown> {
  if (schema.type === "object") return schema;

  const next = { ...schema };
  if (Array.isArray(next.type)) {
    if (!next.type.includes("null")) next.type = [...next.type, "null"];
  } else if (typeof next.type === "string") {
    next.type = [next.type, "null"];
  }
  if (Array.isArray(next.enum) && !next.enum.includes(null)) {
    next.enum = [...next.enum, null];
  }
  return next;
}

function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node === null || typeof node !== "object") return node;

  const source = node as Record<string, unknown>;
  const originalRequired = new Set(
    Array.isArray(source.required) ? (source.required as string[]) : [],
  );
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (key === "required") continue;
    if (key === "properties" && value && typeof value === "object") {
      const properties = value as Record<string, unknown>;
      const nextProperties: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(properties)) {
        const recursed = toStrictSchema(propSchema) as Record<string, unknown>;
        nextProperties[propName] = originalRequired.has(propName)
          ? recursed
          : makeNullable(recursed);
      }
      result.properties = nextProperties;
      continue;
    }
    result[key] = toStrictSchema(value);
  }

  if (source.type === "object" && source.properties) {
    result.additionalProperties = false;
    result.required = Object.keys(source.properties as Record<string, unknown>);
  }

  return result;
}

// Plain JSON Schema mirror of LESSON_RESPONSE_SCHEMA (which is written in
// Gemini's own Type.* dialect). Groq's json_schema mode and Cohere's
// responseFormat.jsonSchema both take standard JSON Schema, so they share
// this — `required` below marks which fields are genuinely mandatory; every
// other field is turned nullable-but-present by toStrictSchema(), below.
const RAW_LESSON_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    teaching_phase: {
      type: "string",
      enum: ["introduction", "explanation", "assessment", "scaffolding"],
    },
    student_profile: {
      type: "object",
      properties: {
        understood_concepts: { type: "array", items: { type: "string" } },
        identified_misconceptions: { type: "array", items: { type: "string" } },
      },
      required: ["understood_concepts", "identified_misconceptions"],
    },
    avatar_script: { type: "string" },
    visual_director: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["avatar", "code", "diagram", "concept_flow", "quiz"],
        },
        code_snippet: { type: "string" },
        highlight_lines: { type: "array", items: { type: "integer" } },
        diagram_data: {
          type: "object",
          properties: {
            nodes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  status: { type: "string", enum: ["active", "success", "warning"] },
                },
                required: ["id", "label"],
              },
            },
            edges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  label: { type: "string" },
                },
                required: ["from", "to"],
              },
            },
          },
          required: ["nodes", "edges"],
        },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correct_index: { type: "integer" },
              explanation: { type: "string" },
              concept_id: { type: "string" },
            },
            required: ["id", "question", "options", "correct_index", "explanation"],
          },
        },
        caption: { type: "string" },
      },
      required: ["mode", "caption"],
    },
    concept_plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: {
            type: "string",
            enum: ["completed", "current", "misconception", "locked"],
          },
        },
        required: ["id", "label", "status"],
      },
    },
  },
  required: [
    "teaching_phase",
    "student_profile",
    "avatar_script",
    "visual_director",
    "concept_plan",
  ],
};

export const LESSON_JSON_SCHEMA: Record<string, unknown> = toStrictSchema(
  RAW_LESSON_JSON_SCHEMA,
) as Record<string, unknown>;

// Appended to the system prompt for providers that only guarantee syntactically
// valid JSON (Groq's Llama models), where nothing enforces the shape server-side.
export const SCHEMA_PROMPT_BLOCK = `OUTPUT FORMAT — respond with a single JSON object and absolutely nothing else. No prose before or after it, and no markdown code fences. The object must have exactly these keys:

{
  "teaching_phase": one of "introduction" | "explanation" | "assessment" | "scaffolding",
  "student_profile": { "understood_concepts": string[], "identified_misconceptions": string[] },
  "avatar_script": string,
  "visual_director": {
    "mode": one of "avatar" | "code" | "diagram" | "concept_flow" | "quiz",
    "caption": string,
    "code_snippet": string (only when mode is "code"),
    "highlight_lines": number[] (only when mode is "code"),
    "diagram_data": { "nodes": [{ "id": string, "label": string, "status"?: "active" | "success" | "warning" }], "edges": [{ "from": string, "to": string, "label"?: string }] } (only when mode is "diagram" or "concept_flow"),
    "questions": [{ "id": string, "question": string, "options": string[4], "correct_index": number, "explanation": string, "concept_id"?: string }] (only when mode is "quiz")
  },
  "concept_plan": [{ "id": string, "label": string, "status": "completed" | "current" | "misconception" | "locked" }]
}`;

const TEACHING_PHASES: readonly TeachingPhase[] = [
  "introduction",
  "explanation",
  "assessment",
  "scaffolding",
];
const VISUAL_MODES: readonly VisualMode[] = [
  "avatar",
  "code",
  "diagram",
  "concept_flow",
  "quiz",
];
const CONCEPT_STATUSES: readonly ConceptStatus[] = [
  "completed",
  "current",
  "misconception",
  "locked",
];

/**
 * Pulls a JSON object out of raw model output. Models in loose JSON mode
 * regularly wrap the object in ```json fences or add a sentence of preamble,
 * so take the outermost balanced braces rather than trusting the whole string.
 */
function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function coerceConceptPlan(value: unknown, fallback: ConceptNode[]): ConceptNode[] {
  if (!Array.isArray(value)) return fallback;
  const plan = value.flatMap((entry): ConceptNode[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label : null;
    if (!label) return [];
    const id = typeof record.id === "string" && record.id ? record.id : label;
    const status = CONCEPT_STATUSES.includes(record.status as ConceptStatus)
      ? (record.status as ConceptStatus)
      : "locked";
    return [{ id, label, status }];
  });
  return plan.length > 0 ? plan : fallback;
}

function coerceQuestions(value: unknown): QuizQuestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const questions = value.flatMap((entry, index): QuizQuestion[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question : null;
    const options = asStringArray(record.options);
    if (!question || options.length < 2) return [];
    const rawIndex = record.correct_index;
    const correctIndex =
      typeof rawIndex === "number" && rawIndex >= 0 && rawIndex < options.length
        ? Math.floor(rawIndex)
        : 0;
    return [
      {
        id: typeof record.id === "string" && record.id ? record.id : `q${index + 1}`,
        question,
        options,
        correct_index: correctIndex,
        explanation:
          typeof record.explanation === "string" ? record.explanation : "",
        concept_id: typeof record.concept_id === "string" ? record.concept_id : undefined,
      },
    ];
  });
  return questions.length > 0 ? questions : undefined;
}

export class LessonParseError extends Error {}

/**
 * Turns raw model output into a LessonPayload, repairing the shortfalls that
 * loose-JSON providers produce: fenced output, a missing concept_plan, an
 * out-of-range correct_index, an unknown mode. `state` supplies the values a
 * mid-lesson turn can legitimately inherit rather than regenerate.
 *
 * Throws only when there is no usable object or no spoken line at all — those
 * cannot be repaired, and are worth failing over for.
 */
export function parseLessonPayload(raw: string, state?: LessonState): LessonPayload {
  const json = extractJsonObject(raw);
  if (!json) throw new LessonParseError("No JSON object found in the model output.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new LessonParseError("Model output was not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new LessonParseError("Model output was not a JSON object.");
  }

  const record = parsed as Record<string, unknown>;

  const avatarScript =
    typeof record.avatar_script === "string" ? record.avatar_script.trim() : "";
  if (!avatarScript) {
    throw new LessonParseError("Model output carried no avatar_script.");
  }

  const phase = TEACHING_PHASES.includes(record.teaching_phase as TeachingPhase)
    ? (record.teaching_phase as TeachingPhase)
    : (state?.teaching_phase ?? "explanation");

  const profileRecord =
    typeof record.student_profile === "object" && record.student_profile !== null
      ? (record.student_profile as Record<string, unknown>)
      : {};

  const directorRecord =
    typeof record.visual_director === "object" && record.visual_director !== null
      ? (record.visual_director as Record<string, unknown>)
      : {};

  const mode = VISUAL_MODES.includes(directorRecord.mode as VisualMode)
    ? (directorRecord.mode as VisualMode)
    : "avatar";

  const diagramRecord =
    typeof directorRecord.diagram_data === "object" && directorRecord.diagram_data !== null
      ? (directorRecord.diagram_data as Record<string, unknown>)
      : null;

  return {
    teaching_phase: phase,
    student_profile: {
      understood_concepts: asStringArray(profileRecord.understood_concepts),
      identified_misconceptions: asStringArray(profileRecord.identified_misconceptions),
    },
    avatar_script: avatarScript,
    visual_director: {
      mode,
      caption:
        typeof directorRecord.caption === "string" && directorRecord.caption
          ? directorRecord.caption
          : "Live lesson",
      code_snippet:
        typeof directorRecord.code_snippet === "string"
          ? directorRecord.code_snippet
          : undefined,
      highlight_lines: Array.isArray(directorRecord.highlight_lines)
        ? directorRecord.highlight_lines.filter(
            (line): line is number => typeof line === "number",
          )
        : undefined,
      diagram_data: diagramRecord
        ? {
            nodes: Array.isArray(diagramRecord.nodes)
              ? (diagramRecord.nodes as Record<string, unknown>[]).flatMap((node) =>
                  typeof node?.id === "string" && typeof node?.label === "string"
                    ? [
                        {
                          id: node.id,
                          label: node.label,
                          status:
                            node.status === "active" ||
                            node.status === "success" ||
                            node.status === "warning"
                              ? node.status
                              : undefined,
                        },
                      ]
                    : [],
                )
              : [],
            edges: Array.isArray(diagramRecord.edges)
              ? (diagramRecord.edges as Record<string, unknown>[]).flatMap((edge) =>
                  typeof edge?.from === "string" && typeof edge?.to === "string"
                    ? [
                        {
                          from: edge.from,
                          to: edge.to,
                          label: typeof edge.label === "string" ? edge.label : undefined,
                        },
                      ]
                    : [],
                )
              : [],
          }
        : undefined,
      questions: coerceQuestions(directorRecord.questions),
    },
    concept_plan: coerceConceptPlan(record.concept_plan, state?.concept_plan ?? []),
  };
}
