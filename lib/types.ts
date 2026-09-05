// Mirrors the JSON state-machine payload emitted by the ai-pedagogy-engine skill
// (.claude/skills/ai-pedagogy-engine/SKILL.md) at the end of every teaching turn.

export type TeachingPhase =
  | "introduction"
  | "explanation"
  | "assessment"
  | "scaffolding";

export interface StudentProfile {
  understood_concepts: string[];
  identified_misconceptions: string[];
}

// What the Stage panel should render this turn. "concept_flow" is treated as
// a diagram variant (same renderer, distinct semantic label from the model).
export type VisualMode = "avatar" | "code" | "diagram" | "concept_flow" | "quiz";

export type DiagramNodeStatus = "active" | "success" | "warning";

export interface DiagramNode {
  id: string;
  label: string;
  status?: DiagramNodeStatus;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  // 0-indexed position of the correct entry in `options`.
  correct_index: number;
  explanation: string;
  // id of the concept_plan entry this question tests, when it maps cleanly
  // to one — used to compute per-concept mastery on the report card.
  concept_id?: string;
}

export interface VisualDirector {
  mode: VisualMode;
  // Present when mode === "code".
  code_snippet?: string;
  // 1-indexed line numbers to highlight; the last entry is treated as the
  // current "active" execution line.
  highlight_lines?: number[];
  // Present when mode === "diagram" | "concept_flow".
  diagram_data?: DiagramData;
  // Present when mode === "quiz".
  questions?: QuizQuestion[];
  // Short human-readable summary of what's on screen, shown under the Stage.
  caption: string;
}

export type ConceptStatus = "completed" | "current" | "misconception" | "locked";

export interface ConceptNode {
  id: string;
  label: string;
  status: ConceptStatus;
}

export interface LessonPayload {
  teaching_phase: TeachingPhase;
  student_profile: StudentProfile;
  avatar_script: string;
  visual_director: VisualDirector;
  // The full ordered sequence of 3-4 micro-concepts for the current topic,
  // each carrying its live mastery status. Extends the base SKILL.md schema
  // so the Concept Skill Tree can render directly from the engine's response.
  concept_plan: ConceptNode[];
}

// A callback ref rather than a RefObject: the live webcam <video> element is
// mounted by either the full-stage call or the picture-in-picture preview, and
// the stream has to be re-attached to whichever one React mounts.
export type VideoRefCallback = (element: HTMLVideoElement | null) => void;

export type ChatRole = "student" | "teacher";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------
// Three providers back the same teaching loop. Each turn carries the whole
// lesson state (see LessonState), so a turn can be served by any of them
// without the student losing their place — that is what makes failover safe.

export const AI_PROVIDERS = ["gemini", "groq", "cohere"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  cohere: "Cohere",
};

/** Which env var holds each provider's key, surfaced in setup errors. */
export const PROVIDER_ENV_VARS: Record<AiProvider, string> = {
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  cohere: "COHERE_API_KEY",
};

/**
 * How reliably a model can be held to the lesson schema.
 *   "schema" — the provider validates our JSON Schema server-side.
 *   "json"   — the provider only guarantees syntactically valid JSON, so the
 *              schema goes in the prompt and the response is repaired
 *              client-side (see lib/providers/lesson-schema.ts).
 */
export type JsonMode = "schema" | "json";

export interface TeacherModel {
  id: TeacherModelId;
  provider: AiProvider;
  /** The identifier the provider's own API expects. */
  modelName: string;
  label: string;
  supportsThinking: boolean;
  /** Whether a webcam frame can be attached to the turn. */
  supportsVision: boolean;
  jsonMode: JsonMode;
}

// gemini-2.5-* are retired for new API keys; Google's own 404 response named
// the 3.x models as the live successors. Groq retired mixtral-8x7b-32768 and
// then, later, both llama-3.3-70b-versatile and llama-3.1-8b-instant
// entirely — neither shows up in GET /openai/v1/models anymore, hence the
// Qwen/GPT-OSS replacements below. Cohere retired the bare
// "command-r"/"command-r-plus" aliases in September 2025 — hence the dated
// Cohere ids.
export const TEACHER_MODEL_IDS = [
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-pro-preview",
  "groq-qwen3.8-27b",
  "groq-gpt-oss-20b",
  "groq-gpt-oss-120b",
  "cohere-command-a",
  "cohere-command-r-plus",
  "cohere-command-r",
] as const;

export type TeacherModelId = (typeof TEACHER_MODEL_IDS)[number];

export const TEACHER_MODELS: Record<TeacherModelId, TeacherModel> = {
  "gemini-3.5-flash-lite": {
    id: "gemini-3.5-flash-lite",
    provider: "gemini",
    modelName: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite (Fastest)",
    // The flash-lite tier doesn't support extended thinking.
    supportsThinking: false,
    supportsVision: true,
    jsonMode: "schema",
  },
  "gemini-3.6-flash": {
    id: "gemini-3.6-flash",
    provider: "gemini",
    modelName: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash (Balanced)",
    supportsThinking: true,
    supportsVision: true,
    jsonMode: "schema",
  },
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview",
    provider: "gemini",
    modelName: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview (Deep Research)",
    supportsThinking: true,
    supportsVision: true,
    jsonMode: "schema",
  },
  "groq-qwen3.8-27b": {
    id: "groq-qwen3.8-27b",
    provider: "groq",
    modelName: "qwen/qwen3.8-27b",
    label: "Qwen3.8 27B (Groq)",
    supportsThinking: false,
    supportsVision: false,
    // Groq enforces json_schema on its GPT-OSS and Qwen models.
    jsonMode: "schema",
  },
  "groq-gpt-oss-20b": {
    id: "groq-gpt-oss-20b",
    provider: "groq",
    modelName: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B Instant (Groq)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "json",
  },
  "groq-gpt-oss-120b": {
    id: "groq-gpt-oss-120b",
    provider: "groq",
    modelName: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "json",
  },
  "cohere-command-a": {
    id: "cohere-command-a",
    provider: "cohere",
    modelName: "command-a-03-2025",
    label: "Command A (Cohere)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "schema",
  },
  "cohere-command-r-plus": {
    id: "cohere-command-r-plus",
    provider: "cohere",
    modelName: "command-r-plus-08-2024",
    label: "Command R+ (Cohere)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "schema",
  },
  "cohere-command-r": {
    id: "cohere-command-r",
    provider: "cohere",
    modelName: "command-r-08-2024",
    label: "Command R (Cohere)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "schema",
  },
};

export const TEACHER_MODEL_LIST: TeacherModel[] = TEACHER_MODEL_IDS.map(
  (id) => TEACHER_MODELS[id],
);

export function isTeacherModelId(value: unknown): value is TeacherModelId {
  return typeof value === "string" && (TEACHER_MODEL_IDS as readonly string[]).includes(value);
}

/**
 * Everything a fresh provider needs to carry on an in-progress lesson rather
 * than starting a new one. Sent on every turn so a failover mid-lesson is
 * invisible to the student.
 */
export interface LessonState {
  teaching_phase: TeachingPhase;
  concept_plan: ConceptNode[];
  student_profile: StudentProfile;
}

export const TEACHER_PERSONAS = ["standard", "srk", "amitabh", "rancho"] as const;

export type TeacherPersona = (typeof TEACHER_PERSONAS)[number];

export interface PersonaOption {
  value: TeacherPersona;
  label: string;
}

export const PERSONA_OPTIONS: PersonaOption[] = [
  { value: "standard", label: "Standard Educator" },
  { value: "srk", label: "Charming Storyteller (Filmi)" },
  { value: "amitabh", label: "Strict Guru (Quiz Master)" },
  { value: "rancho", label: "Practical Rebel (Anti-Rote)" },
];

// Base avatar material colors per persona (head gets a lighter tint of the
// same hue). Standard keeps the app's original indigo/purple look.
export const PERSONA_COLORS: Record<TeacherPersona, { head: string; body: string }> = {
  standard: { head: "#818cf8", body: "#6366f1" },
  srk: { head: "#f87171", body: "#b91c1c" },
  amitabh: { head: "#e2e8f0", body: "#94a3b8" },
  rancho: { head: "#fde047", body: "#eab308" },
};

// Which Edge neural voice family a turn is spoken with. The three character
// personas are written as male voices; only "standard" is switchable, so the
// educator's face and voice always agree (see lib/avatar-theme.ts).
export const VOICE_GENDERS = ["male", "female"] as const;

export type VoiceGender = (typeof VOICE_GENDERS)[number];

export interface VoiceGenderOption {
  value: VoiceGender;
  label: string;
}

export const VOICE_GENDER_OPTIONS: VoiceGenderOption[] = [
  { value: "male", label: "Male voice" },
  { value: "female", label: "Female voice" },
];

export const LANGUAGES = ["english", "hindi", "hinglish"] as const;

export type Language = (typeof LANGUAGES)[number];

export interface LanguageOption {
  value: Language;
  label: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish (Mixed)" },
];

// BCP-47 tags handed to the browser's SpeechRecognition engine.
//
// Note this deliberately does NOT match the TTS voice mapping in
// lib/tts-voices.ts, and the asymmetry is the whole point:
//   - Speaking TO the student, Hinglish is best rendered by an en-IN neural
//     voice reading phonetic Latin text.
//   - Listening TO the student, Hinglish must use hi-IN. An en-IN recogniser
//     has an English lexicon and physically cannot emit a Hindi word — it
//     force-fits every one to the nearest English token, which is why
//     "mujhe samajh nahi aaya" came back as unrelated English. hi-IN is
//     trained on the code-mixed speech Indians actually produce and returns
//     Hindi in Devanagari, which Gemini reads without trouble.
export const SPEECH_RECOGNITION_LOCALES: Record<Language, string> = {
  english: "en-IN",
  hinglish: "hi-IN",
  hindi: "hi-IN",
};

export const TIME_BUDGETS = ["crash_course", "standard", "deep_dive"] as const;

export type TimeBudget = (typeof TIME_BUDGETS)[number];

export interface TimeBudgetOption {
  value: TimeBudget;
  label: string;
}

export const TIME_BUDGET_OPTIONS: TimeBudgetOption[] = [
  { value: "crash_course", label: "5-Minute Crash Course" },
  { value: "standard", label: "15-Minute Standard Lesson" },
  { value: "deep_dive", label: "Comprehensive Deep Dive" },
];

// Non-verbal signals recognised from the webcam during a live video call and
// translated into a pedagogical instruction for the engine.
//   understood      👍 thumbs up          — reinforce, then move on
//   not_understood  👎 thumbs down        — re-explain, simpler, in Hinglish
//   confused        head shake (L↔R)      — stop, diagnose, ask a question
//   agreement       head nod (U↕D)        — brief confirmation, advance
export const GESTURE_SIGNALS = [
  "understood",
  "not_understood",
  "confused",
  "agreement",
] as const;

export type GestureSignal = (typeof GESTURE_SIGNALS)[number];

export interface GestureSignalMeta {
  value: GestureSignal;
  glyph: string;
  label: string;
  meaning: string;
  /** Tailwind text colour used by the live gesture HUD. */
  tone: string;
}

export const GESTURE_SIGNAL_META: Record<GestureSignal, GestureSignalMeta> = {
  understood: {
    value: "understood",
    glyph: "👍",
    label: "Thumbs up",
    meaning: "Understood",
    tone: "text-emerald-400",
  },
  not_understood: {
    value: "not_understood",
    glyph: "👎",
    label: "Thumbs down",
    meaning: "Not understood",
    tone: "text-rose-400",
  },
  confused: {
    value: "confused",
    glyph: "🔄",
    label: "Head shake",
    meaning: "Confused",
    tone: "text-amber-400",
  },
  agreement: {
    value: "agreement",
    glyph: "↕️",
    label: "Head nod",
    meaning: "Following along",
    tone: "text-sky-400",
  },
};

// "take_quiz" asks the engine to generate an assessment instead of continuing
// the explanation loop — see the "quiz" visual_director mode in
// lib/pedagogy-engine.ts.
export type TeachAction = "teach" | "take_quiz";

// "feynman" inverts the usual teaching direction: the AI plays a student
// holding a plausible misconception, and the human explains it back — see
// FEYNMAN_SYSTEM_PROMPT in lib/pedagogy-engine.ts.
export const TEACH_MODES = ["socratic", "feynman"] as const;

export type TeachMode = (typeof TEACH_MODES)[number];

// Literal marker the model appends to the end of avatar_script when, in
// Feynman mode, the human's explanation has genuinely resolved its
// misconception. Defined here (not in lib/pedagogy-engine.ts, which is
// server-only) so both the prompt text and the client-side detection/strip
// logic in components/dashboard.tsx share one source of truth.
export const FEYNMAN_MASTERED_TOKEN = "[[CONCEPT_MASTERED]]";

export interface TeachRequestBody {
  history: ChatMessage[];
  message: string;
  uploadedContent?: string;
  modelId: TeacherModelId;
  extendedThinking: boolean;
  persona: TeacherPersona;
  language: Language;
  timeBudget: TimeBudget;
  action?: TeachAction;
  // Defaults to "socratic" (the normal teaching loop) when omitted.
  mode?: TeachMode;
  // The lesson's current concept_plan — only used (and required for good
  // results) when action is "take_quiz", so the engine can target questions
  // at concepts the student has actually covered.
  conceptPlan?: ConceptNode[];
  // A single webcam snapshot captured during a live video call, base64-encoded
  // JPEG bytes with the "data:image/jpeg;base64," prefix already stripped.
  webcamFrame?: string;
  // Set when this turn was triggered by a recognised webcam gesture rather
  // than typed or spoken input.
  gestureSignal?: GestureSignal;
  // The lesson as it stands right now. Replayed into the prompt so whichever
  // provider serves this turn resumes the same concept plan instead of
  // inventing a new one — this is what keeps a failover from resetting the
  // student's progress.
  lessonState?: LessonState;
}

/** Which model actually produced the turn — may differ from the one requested. */
export interface ServedBy {
  modelId: TeacherModelId;
  provider: AiProvider;
  label: string;
  /** True when failover moved the turn off the requested model. */
  switched: boolean;
}

export type TeachResponseBody =
  | { ok: true; payload: LessonPayload; servedBy: ServedBy }
  | { ok: false; error: string };

export interface ProvidersResponseBody {
  /** Providers whose API key is present on the server. */
  configured: AiProvider[];
}

export type UploadResponseBody =
  | { ok: true; fileName: string; text: string }
  | { ok: false; error: string };

export interface TtsRequestBody {
  text: string;
  persona: TeacherPersona;
  language: Language;
  voiceGender: VoiceGender;
}

// The success path returns raw `audio/mpeg` bytes, not JSON — this only
// covers the error path (non-2xx responses from /api/tts).
export interface TtsErrorBody {
  error: string;
}

export interface RefinePromptRequestBody {
  rawPrompt: string;
}

export type RefinePromptResponseBody =
  | { ok: true; refinedPrompt: string }
  | { ok: false; error: string };

// Computed client-side once every quiz question has been answered — not part
// of the Gemini response schema.
export interface QuizReport {
  scorePercent: number;
  masteredConcepts: string[];
  weakConcepts: string[];
  recommendation: string;
}
