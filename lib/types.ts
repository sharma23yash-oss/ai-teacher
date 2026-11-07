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

/**
 * What the student picks. Raw model names mean nothing to a learner, so the
 * picker shows three speed/depth tiers; the provider and model behind each
 * tier only appear in its tooltip.
 */
export const MODEL_TIERS = ["fast", "balanced", "deep"] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

export const MODEL_TIER_META: Record<ModelTier, { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Quickest replies, lighter explanations" },
  balanced: { label: "Balanced", hint: "Good depth at a comfortable speed" },
  deep: { label: "Deep", hint: "Most thorough reasoning, slower replies" },
};

export interface TeacherModel {
  id: TeacherModelId;
  provider: AiProvider;
  tier: ModelTier;
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
    tier: "fast",
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
    tier: "balanced",
    modelName: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash (Balanced)",
    supportsThinking: true,
    supportsVision: true,
    jsonMode: "schema",
  },
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview",
    provider: "gemini",
    tier: "deep",
    modelName: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview (Deep Research)",
    supportsThinking: true,
    supportsVision: true,
    jsonMode: "schema",
  },
  "groq-qwen3.8-27b": {
    id: "groq-qwen3.8-27b",
    provider: "groq",
    tier: "balanced",
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
    tier: "fast",
    modelName: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B Instant (Groq)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "json",
  },
  "groq-gpt-oss-120b": {
    id: "groq-gpt-oss-120b",
    provider: "groq",
    tier: "deep",
    modelName: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B (Groq)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "json",
  },
  "cohere-command-a": {
    id: "cohere-command-a",
    provider: "cohere",
    tier: "deep",
    modelName: "command-a-03-2025",
    label: "Command A (Cohere)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "schema",
  },
  "cohere-command-r-plus": {
    id: "cohere-command-r-plus",
    provider: "cohere",
    tier: "balanced",
    modelName: "command-r-plus-08-2024",
    label: "Command R+ (Cohere)",
    supportsThinking: false,
    supportsVision: false,
    jsonMode: "schema",
  },
  "cohere-command-r": {
    id: "cohere-command-r",
    provider: "cohere",
    tier: "fast",
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

export const LANGUAGES = [
  "english",
  "hinglish",
  "hindi",
  "marathi",
  "bengali",
  "tamil",
  "telugu",
  "gujarati",
  "kannada",
  "malayalam",
  "urdu",
  "spanish",
  "french",
  "german",
  "portuguese",
  "arabic",
  "russian",
  "japanese",
  "mandarin",
] as const;

export type Language = (typeof LANGUAGES)[number];

export interface LanguageOption {
  value: Language;
  label: string;
}

/**
 * One row per teaching language, and the single source of truth for four
 * things that must never drift apart: the label in the picker, the script the
 * model is told to write avatar_script in, the Edge neural voices that speak
 * it, and the locale the browser recogniser listens in.
 *
 * `script` is load-bearing rather than cosmetic. A neural voice trained on
 * Devanagari mispronounces romanised Hindi badly, and an en-IN voice reading
 * Devanagari produces nothing usable — so the prompt has to name the script
 * explicitly, and it reads that name from here.
 */
export interface LanguageMeta {
  value: Language;
  label: string;
  /** Written form the model must produce, named as the prompt should say it. */
  scriptName: string;
  /** BCP-47 tag for the browser SpeechRecognition engine. */
  speechLocale: string;
  /** Edge neural voice used for a male-voiced turn. */
  voiceMale: string;
  /** Edge neural voice used for a female-voiced turn. */
  voiceFemale: string;
  group: "Indian" | "International";
}

export const LANGUAGE_META: Record<Language, LanguageMeta> = {
  english: {
    value: "english",
    label: "English",
    scriptName: "Latin (Roman) script",
    speechLocale: "en-IN",
    voiceMale: "en-IN-PrabhatNeural",
    voiceFemale: "en-IN-NeerjaNeural",
    group: "Indian",
  },
  hinglish: {
    value: "hinglish",
    label: "Hinglish (Mixed)",
    scriptName: "Latin (Roman) script",
    // hi-IN listens to code-mixed speech; en-IN speaks phonetic Roman Hindi.
    // The asymmetry is deliberate — see SPEECH_RECOGNITION_LOCALES below.
    speechLocale: "hi-IN",
    voiceMale: "en-IN-PrabhatNeural",
    voiceFemale: "en-IN-NeerjaNeural",
    group: "Indian",
  },
  hindi: {
    value: "hindi",
    label: "Hindi",
    scriptName: "Devanagari script",
    speechLocale: "hi-IN",
    voiceMale: "hi-IN-MadhurNeural",
    voiceFemale: "hi-IN-SwaraNeural",
    group: "Indian",
  },
  marathi: {
    value: "marathi",
    label: "Marathi",
    scriptName: "Devanagari script",
    speechLocale: "mr-IN",
    voiceMale: "mr-IN-ManoharNeural",
    voiceFemale: "mr-IN-AarohiNeural",
    group: "Indian",
  },
  bengali: {
    value: "bengali",
    label: "Bengali",
    scriptName: "Bengali script",
    speechLocale: "bn-IN",
    voiceMale: "bn-IN-BashkarNeural",
    voiceFemale: "bn-IN-TanishaaNeural",
    group: "Indian",
  },
  tamil: {
    value: "tamil",
    label: "Tamil",
    scriptName: "Tamil script",
    speechLocale: "ta-IN",
    voiceMale: "ta-IN-ValluvarNeural",
    voiceFemale: "ta-IN-PallaviNeural",
    group: "Indian",
  },
  telugu: {
    value: "telugu",
    label: "Telugu",
    scriptName: "Telugu script",
    speechLocale: "te-IN",
    voiceMale: "te-IN-MohanNeural",
    voiceFemale: "te-IN-ShrutiNeural",
    group: "Indian",
  },
  gujarati: {
    value: "gujarati",
    label: "Gujarati",
    scriptName: "Gujarati script",
    speechLocale: "gu-IN",
    voiceMale: "gu-IN-NiranjanNeural",
    voiceFemale: "gu-IN-DhwaniNeural",
    group: "Indian",
  },
  kannada: {
    value: "kannada",
    label: "Kannada",
    scriptName: "Kannada script",
    speechLocale: "kn-IN",
    voiceMale: "kn-IN-GaganNeural",
    voiceFemale: "kn-IN-SapnaNeural",
    group: "Indian",
  },
  malayalam: {
    value: "malayalam",
    label: "Malayalam",
    scriptName: "Malayalam script",
    speechLocale: "ml-IN",
    voiceMale: "ml-IN-MidhunNeural",
    voiceFemale: "ml-IN-SobhanaNeural",
    group: "Indian",
  },
  urdu: {
    value: "urdu",
    label: "Urdu",
    scriptName: "Perso-Arabic (Urdu) script",
    speechLocale: "ur-IN",
    voiceMale: "ur-IN-SalmanNeural",
    voiceFemale: "ur-IN-GulNeural",
    group: "Indian",
  },
  spanish: {
    value: "spanish",
    label: "Spanish",
    scriptName: "Latin (Roman) script",
    speechLocale: "es-ES",
    voiceMale: "es-ES-AlvaroNeural",
    voiceFemale: "es-ES-ElviraNeural",
    group: "International",
  },
  french: {
    value: "french",
    label: "French",
    scriptName: "Latin (Roman) script",
    speechLocale: "fr-FR",
    voiceMale: "fr-FR-HenriNeural",
    voiceFemale: "fr-FR-DeniseNeural",
    group: "International",
  },
  german: {
    value: "german",
    label: "German",
    scriptName: "Latin (Roman) script",
    speechLocale: "de-DE",
    voiceMale: "de-DE-ConradNeural",
    voiceFemale: "de-DE-KatjaNeural",
    group: "International",
  },
  portuguese: {
    value: "portuguese",
    label: "Portuguese",
    scriptName: "Latin (Roman) script",
    speechLocale: "pt-BR",
    voiceMale: "pt-BR-AntonioNeural",
    voiceFemale: "pt-BR-FranciscaNeural",
    group: "International",
  },
  arabic: {
    value: "arabic",
    label: "Arabic",
    scriptName: "Arabic script",
    speechLocale: "ar-EG",
    voiceMale: "ar-EG-ShakirNeural",
    voiceFemale: "ar-EG-SalmaNeural",
    group: "International",
  },
  russian: {
    value: "russian",
    label: "Russian",
    scriptName: "Cyrillic script",
    speechLocale: "ru-RU",
    voiceMale: "ru-RU-DmitryNeural",
    voiceFemale: "ru-RU-SvetlanaNeural",
    group: "International",
  },
  japanese: {
    value: "japanese",
    label: "Japanese",
    scriptName: "Japanese script (kanji, hiragana and katakana)",
    speechLocale: "ja-JP",
    voiceMale: "ja-JP-KeitaNeural",
    voiceFemale: "ja-JP-NanamiNeural",
    group: "International",
  },
  mandarin: {
    value: "mandarin",
    label: "Mandarin Chinese",
    scriptName: "Simplified Chinese characters",
    speechLocale: "zh-CN",
    voiceMale: "zh-CN-YunxiNeural",
    voiceFemale: "zh-CN-XiaoxiaoNeural",
    group: "International",
  },
};

export const LANGUAGE_OPTIONS: LanguageOption[] = LANGUAGES.map((value) => ({
  value,
  label: LANGUAGE_META[value].label,
}));

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
export const SPEECH_RECOGNITION_LOCALES: Record<Language, string> = Object.fromEntries(
  LANGUAGES.map((value) => [value, LANGUAGE_META[value].speechLocale]),
) as Record<Language, string>;

export const TIME_BUDGETS = [
  "crash_course",
  "standard",
  "deep_dive",
  "hour_long",
  "seven_day",
] as const;

export type TimeBudget = (typeof TIME_BUDGETS)[number];

export interface TimeBudgetOption {
  value: TimeBudget;
  label: string;
  /**
   * How many concepts the plan should hold at this budget. A single
   * micro-lesson wants 3-4; a multi-session plan is a curriculum and needs
   * room for a real sequence, which is why this is not one fixed number.
   */
  conceptCount: string;
  /** Written into the prompt verbatim, so each budget shapes depth not just length. */
  shape: string;
}

export const TIME_BUDGET_OPTIONS: TimeBudgetOption[] = [
  {
    value: "crash_course",
    label: "5-Minute Crash Course",
    conceptCount: "exactly 3",
    shape:
      "Five minutes. Cover only the most important ideas, one sentence of context each, no tangents. Skip nuance the student can live without today.",
  },
  {
    value: "standard",
    label: "20-Minute Standard Lesson",
    conceptCount: "exactly 3 to 4",
    shape:
      "Twenty minutes. A structured lesson over the key concepts, each with one worked example and one check question.",
  },
  {
    value: "deep_dive",
    label: "60-Minute Deep Dive",
    conceptCount: "6 to 8",
    shape:
      "Sixty minutes. Go deeper: full explanations, multiple examples, edge cases, a question after every concept, and a closing assessment.",
  },
  {
    value: "hour_long",
    label: "Full Topic Mastery",
    conceptCount: "8 to 10",
    shape:
      "A complete course on the topic, taught end to end. Build a full learning path from fundamentals through to advanced application, and teach it in order.",
  },
  {
    value: "seven_day",
    label: "7-Day Study Plan",
    conceptCount: "exactly 7",
    shape:
      "A seven-day revision plan. Produce exactly one concept per day and label each one with its day, so concept_plan reads as Day 1 through Day 7. Teach the current day's concept now, and tell the student what tomorrow covers.",
  },
];

/**
 * Section 6 of the brief lets the learner state their level; this makes it a
 * control rather than something they have to remember to type. The
 * descriptions are written into the prompt verbatim.
 */
export const LEARNER_LEVELS = ["beginner", "intermediate", "advanced"] as const;

export type LearnerLevel = (typeof LEARNER_LEVELS)[number];

export interface LearnerLevelOption {
  value: LearnerLevel;
  label: string;
  instruction: string;
}

export const LEARNER_LEVEL_OPTIONS: LearnerLevelOption[] = [
  {
    value: "beginner",
    label: "Beginner",
    instruction:
      "The student is a beginner. Assume no prior exposure. Use simple everyday terminology, lean on analogies from ordinary life, and introduce each technical term only after the idea behind it is already clear. Never assume a prerequisite without checking it first.",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    instruction:
      "The student is at an intermediate level. They know the fundamentals, so skip the ground floor. Use correct technical terminology, and spend the time on practical examples, how the pieces fit together, and where people usually go wrong.",
  },
  {
    value: "advanced",
    label: "Advanced",
    instruction:
      "The student is advanced. Be precise and technical. Use the field's real vocabulary without softening it, include the underlying mathematics or implementation detail where it matters, discuss trade-offs and edge cases, and pitch questions at application and analysis rather than recall.",
  },
];

export const LEARNER_LEVEL_INSTRUCTIONS: Record<LearnerLevel, string> = Object.fromEntries(
  LEARNER_LEVEL_OPTIONS.map((option) => [option.value, option.instruction]),
) as Record<LearnerLevel, string>;

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
// ---------------------------------------------------------------------------
// Exam prep presets
// ---------------------------------------------------------------------------
// A niche mode for students preparing for a specific exam from their own
// material. The preset changes how the engine teaches (exam vocabulary,
// question formats, marking rules) and leans on the uploaded PDF as the
// syllabus. Without a PDF it still works, but says it is teaching from
// general knowledge.

export const EXAM_PRESETS = ["nism", "cfa", "gate", "board"] as const;

export type ExamPreset = (typeof EXAM_PRESETS)[number];

export interface ExamPresetMeta {
  label: string;
  fullName: string;
  /** Shown under the chip on the landing screen. */
  blurb: string;
  /** What to suggest uploading. */
  uploadHint: string;
  /** Appended to the system prompt. */
  instruction: string;
  /** File in data/exams/ holding this exam's syllabus map (see lib/exams/syllabi.ts). */
  syllabusId: string;
  /** How descriptive answers are marked, for the question generator and grader. */
  markingStyle: string;
}

export const EXAM_PRESET_META: Record<ExamPreset, ExamPresetMeta> = {
  nism: {
    label: "NISM",
    fullName: "NISM certification (SEBI-mandated securities markets exams)",
    blurb: "Regulations, products and procedures, drilled as MCQs",
    uploadHint: "Upload the NISM workbook PDF for your series",
    instruction:
      "The student is preparing for a NISM certification exam (India's SEBI-mandated securities markets certifications). These are single-correct MCQ tests, usually with negative marking; use the exact format from the syllabus map below when it is given, and do not state numbers it does not give. Emphasise exact regulatory facts that the workbook states: SEBI regulations, definitions, limits, timelines, fees and procedural steps. When you quiz, write questions in NISM's style: one correct option, three plausible distractors that differ on a number, a timeline or a single word of the rule. After each concept, give one memory hook for the exact figure. Remind the student when guessing is not worth the negative mark.",
    syllabusId: "nism-xv",
    markingStyle:
      "NISM is MCQ-only. For a descriptive practice answer, award marks for each exact regulatory fact, figure, timeline or procedural step the scheme lists; no marks for vague paraphrase of a rule.",
  },
  cfa: {
    label: "CFA",
    fullName: "CFA Program (Level I-III)",
    blurb: "Learning outcome statements, formulas and vignettes",
    uploadHint: "Upload the curriculum reading or your notes PDF",
    instruction:
      "The student is preparing for the CFA Program exam. Organise each concept around the Learning Outcome Statement it serves, and use the command words the curriculum uses (calculate, explain, compare, evaluate). Show every formula with a worked numerical example, and flag the common calculator and sign errors. When you quiz, use the CFA format: three options (A, B, C) with no negative marking, and for Level II-style practice a short vignette followed by the question. Point out which ethics standard or reading a fact comes from when the material says so.",
    syllabusId: "cfa-l1",
    markingStyle:
      "CFA constructed-response style: marks for the correct method, the correct formula with inputs, the final answer with units or sign, and a one-line justification; partial credit for correct method with an arithmetic slip.",
  },
  gate: {
    label: "GATE",
    fullName: "GATE (Graduate Aptitude Test in Engineering)",
    blurb: "Concepts to numericals, in MCQ, MSQ and NAT formats",
    uploadHint: "Upload your subject notes or previous-year paper PDF",
    instruction:
      "The student is preparing for GATE. Move quickly from the concept to solving numerical problems, and show the shortest exam-time method alongside the full derivation. When you quiz, mix GATE's three formats: MCQ (one correct answer, negative marking of one-third of the marks), MSQ (one or more correct answers, no negative marking) and NAT (type a numerical answer, no options, no negative marking). Label each question with its format and its marks (1 or 2). Point out common unit and approximation traps, and say which topics appear most often in previous papers when the material indicates it.",
    syllabusId: "gate-cs",
    markingStyle:
      "GATE is objective (no partial credit in the real exam). For descriptive practice, award marks for the correct approach, each key intermediate result, and the final value within the stated precision.",
  },
  board: {
    label: "Board",
    fullName: "School board exams (CBSE / state boards)",
    blurb: "Chapter-wise, marks-based answers with step marking",
    uploadHint: "Upload your textbook chapter or class notes PDF",
    instruction:
      "The student is preparing for a school board exam (CBSE or a state board). Follow the textbook's chapter order and language. Teach answers in the structure examiners reward: the definition or law first, then the explanation, a labelled diagram or formula where relevant, and a worked example; keep 1-mark answers to one line and 5-mark answers to about 120-150 words. When you quiz, mix 1-mark objective questions with 2-, 3- and 5-mark descriptive questions and say how many marks each is worth. Point out common places students lose marks (missing units, unlabelled diagrams, skipped steps).",
    syllabusId: "board",
    markingStyle:
      "Board-exam step marking: split marks across the definition or statement, each required explanation step, the formula or diagram, the substitution and the final answer with units. Award partial marks for each correct step even if the final answer is wrong.",
  },
};

export function isExamPreset(value: unknown): value is ExamPreset {
  return typeof value === "string" && (EXAM_PRESETS as readonly string[]).includes(value);
}

// socratic: the normal teaching loop. feynman: the AI plays a confused
// student and the human teaches it. teachback: the human explains the current
// concept in their own words and the teacher probes the gaps.
export const TEACH_MODES = ["socratic", "feynman", "teachback"] as const;

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
  // Section 6 of the brief: the learner's stated level. Optional so older
  // clients keep working; the engine defaults to "beginner".
  learnerLevel?: LearnerLevel;
  // Handle for a document indexed by /api/upload. When present the engine
  // retrieves the passages relevant to this turn and grounds its answer in
  // them, instead of relying on what the model happens to remember.
  docId?: string;
  // A short briefing on what earlier sessions established about this learner
  // (see lib/learner-profile.ts). Sent so a returning student is met with
  // continuity rather than a blank slate.
  profileBriefing?: string;
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
  // Exam prep preset (NISM, CFA, GATE). Omitted for a normal lesson.
  examPreset?: ExamPreset;
  // Set on a hint request: which rung of the hint ladder to give
  // (1 nudge, 2 hint, 3 worked step, 4 full solution). See lib/learning/hint-ladder.ts.
  hintLevel?: 1 | 2 | 3 | 4;
  // Set for a 10-minute spaced-repetition revision: the exact concepts due,
  // which become the concept_plan instead of a freshly planned lesson.
  revisionConcepts?: string[];
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
  | {
      ok: true;
      payload: LessonPayload;
      servedBy: ServedBy;
      /**
       * The passages retrieval fed the model this turn. Surfaced in the UI so
       * a grounded answer can be traced back to the document it came from —
       * and so an ungrounded one is visibly ungrounded.
       */
      groundedOn?: RetrievedChunk[];
    }
  | { ok: false; error: string };

export interface ProvidersResponseBody {
  /** Providers whose API key is present on the server. */
  configured: AiProvider[];
  /** Where uploaded documents live: "shared" (Upstash, 24 h) or "memory" (this instance only). */
  documentStore?: "shared" | "memory";
}

/** One retrievable passage of an uploaded document. */
export interface KnowledgeChunk {
  id: string;
  /** 1-based position in the document, used for "page 3 of your notes" style citations. */
  index: number;
  /** Nearest preceding heading, when the document had one. */
  heading?: string;
  text: string;
  /** First and last page (or slide) the passage came from, when the document has pages. */
  pageStart?: number;
  pageEnd?: number;
  /** Ready-made citation, e.g. "p. 12", "pp. 12–13", "slide 4". */
  locator?: string;
}

/** One chapter of an uploaded document's outline (see lib/rag/outline.ts). */
export interface OutlineChapter {
  id: string;
  title: string;
  locator?: string;
  pageStart?: number;
  pageEnd?: number;
  chunkIds: string[];
}

/** A passage that retrieval selected for this turn, with its relevance score. */
export interface RetrievedChunk extends KnowledgeChunk {
  score: number;
}

export interface KnowledgeBaseSummary {
  docId: string;
  fileName: string;
  /** Characters of source text indexed — the honest size, before chunking. */
  charCount: number;
  chunkCount: number;
  /** "embeddings" when vectors were built, "lexical" when we fell back. */
  retrieval: "embeddings" | "lexical";
  /** What page numbers count in this document: "page" (PDF), "slide" (PPTX) or null. */
  pageUnit: "page" | "slide" | null;
  /** Chapters detected in the document, for chapter summaries and practice. */
  outline: OutlineChapter[];
}

export type UploadResponseBody =
  | {
      ok: true;
      fileName: string;
      /** Kept for the first turn and for re-indexing if the server restarts. */
      text: string;
      knowledgeBase: KnowledgeBaseSummary;
    }
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
  correctCount: number;
  totalCount: number;
  masteredConcepts: string[];
  weakConcepts: string[];
  /** concept_plan ids the student got wrong — what the lesson must revisit. */
  weakConceptIds: string[];
  /** concept_plan ids the student got right. */
  masteredConceptIds: string[];
  recommendation: string;
}

// ---------------------------------------------------------------------------
// Persistent learner profile (section 14)
// ---------------------------------------------------------------------------

export interface TopicRecord {
  topic: string;
  /** ISO timestamp of the most recent session on this topic. */
  lastStudiedAt: string;
  sessions: number;
  conceptsCompleted: string[];
  conceptsWeak: string[];
  /** Every quiz score recorded for this topic, oldest first. */
  scores: number[];
}

export interface LearnerProfileRecord {
  version: 1;
  createdAt: string;
  updatedAt: string;
  preferredLanguage: Language;
  preferredLevel: LearnerLevel;
  preferredPersona: TeacherPersona;
  preferredTimeBudget: TimeBudget;
  topics: TopicRecord[];
  /** Flat, newest-first activity log shown in the Progress panel. */
  history: {
    at: string;
    topic: string;
    kind: "lesson" | "quiz" | "mastery";
    detail: string;
  }[];
}
