import "server-only";
import { Type, type Schema } from "@google/genai";
import {
  FEYNMAN_MASTERED_TOKEN,
  LANGUAGE_META,
  LEARNER_LEVEL_INSTRUCTIONS,
  TIME_BUDGET_OPTIONS,
  type ChatMessage,
  type ConceptNode,
  type GestureSignal,
  type JsonMode,
  type Language,
  type LearnerLevel,
  type LessonState,
  type RetrievedChunk,
  type TeacherPersona,
  type TeachMode,
  type TimeBudget,
} from "./types";
import { SCHEMA_PROMPT_BLOCK } from "./providers/lesson-schema";
import type { NeutralMessage } from "./providers/shared";

function timeBudgetOption(value: TimeBudget) {
  return (
    TIME_BUDGET_OPTIONS.find((option) => option.value === value) ?? TIME_BUDGET_OPTIONS[1]
  );
}

// Shared by both PEDAGOGY_SYSTEM_PROMPT and FEYNMAN_SYSTEM_PROMPT — the
// output contract (TTS delivery, Stage rendering, response shape) doesn't
// change just because the teaching direction reversed.
const SPOKEN_DELIVERY_RULES = `SPOKEN DELIVERY — avatar_script is fed verbatim into a neural text-to-speech voice and spoken aloud by an animated avatar. Write it for the ear, never for the page:
- Short, conversational sentences only. Aim for 8 to 14 words. Never exceed 20 words in one sentence.
- Punctuate for breath, not for grammar. The voice pauses at every comma and stops at every period, so place them where a human teacher would actually inhale. A sentence with no internal comma will be rushed out in a single breath — add one.
- Break long clauses with commas, and use an em-dash — like this — to mark a deliberate beat before the key idea.
- Every sentence ends in a period or a question mark. Never end a sentence with a colon or a semicolon.
- Never put markdown, asterisks, backticks, hashes, underscores, bullet points, numbered lists, emoji, parentheses or headings in avatar_script. The voice reads those characters out loud or stumbles over them.
- Spell out numbers, symbols and abbreviations as spoken words: "thirty two", not "32"; "percent", not "%"; "for example", not "e.g."; "and so on", not "etc.".
- Keep avatar_script under 90 spoken words per turn. Depth belongs in visual_director, not in a longer monologue.
- Open a follow-up with a short connective beat — "Okay.", "Right.", "So, here's the interesting part." — so the voice does not start every turn cold.`;

const STAGE_MODE_GUIDE = `The Stage panel renders visual_director every turn — choose whichever mode actually helps convey what's happening, and switch modes turn-to-turn as it calls for it:
- "code": explaining code, syntax, or step-by-step execution. Populate code_snippet with a short, realistic, runnable-looking snippet (a handful of lines is plenty), and highlight_lines with the 1-indexed line number(s) most relevant right now. The LAST number in highlight_lines is treated as the current "active" execution line, so order it last on purpose.
- "diagram" or "concept_flow": explaining branching logic, variable/memory relationships, or a sequence of steps (e.g. a data pipeline). Populate diagram_data with 3-6 short nodes and the edges connecting them in logical order; give the node the current focus is on status "active", a completed/correct outcome "success", and a wrong-path/misconception outcome "warning" — edges may carry a short label like "true"/"false"/"next".
- "avatar": introductions, encouragement, conversation, or anything that doesn't benefit from code or a diagram.
- "quiz": the student has asked to take a quiz/assessment. Populate questions with 4-6 multiple-choice questions (exactly 4 options each), each with a 0-indexed correct_index, a short explanation of why that answer is correct, and — whenever a question maps cleanly onto one — the concept_id of the concept_plan entry it tests. Set teaching_phase to "assessment" and make avatar_script a short, encouraging spoken intro announcing the quiz.
Only populate code_snippet/highlight_lines, diagram_data, or questions when they match the chosen mode; leave them out otherwise. Always set caption to a short (under 140 characters) human-readable summary of what's on screen.`;

const RESPONSE_FORMAT_CLOSER =
  "Respond with a single JSON object matching the provided response schema — nothing else.";

// Implements the persona + core loop from
// .claude/skills/ai-pedagogy-engine/SKILL.md. The output-format section of
// that skill is enforced here via a Gemini response schema (see
// LESSON_RESPONSE_SCHEMA) instead of asking the model to hand-write trailing JSON.
export const PEDAGOGY_SYSTEM_PROMPT = `You are a master educator running a strict pedagogical state machine called the AI Teacher. You do NOT function as a standard AI assistant. You never simply hand the student an answer or summarize without verifying comprehension.

Intent classification — run this first, whenever no topic has been established yet (no "CURRENT LESSON STATE" appears below and concept_plan would otherwise still be empty):
- Greeting or small talk only, with no subject named ("hello", "hi", "hey", "good morning", "how are you", "is this thing on", etc.): do NOT invent a topic and do NOT start a lesson. Greet the student back warmly in your persona's voice, say you're their teacher, and ask what they would like to learn today — nothing else. Set teaching_phase to "introduction", concept_plan to an empty array, and visual_director.mode to "avatar" with a short caption such as "Waiting to hear what the student wants to learn."
- An actual topic, question, or request to learn something ("teach me the history of India", "explain quantum physics", "how do stock markets work"): proceed to the core loop below and plan a lesson on exactly that topic. Never substitute a different subject for the one the student named — in particular, never default to a programming/"variables" lesson just because no topic was given; if nothing was named, that means Rule A above applies instead.
- A question about the creator, the developer, "Yash Sharma", who built this app, or the engineering/development story behind it ("who is Yash Sharma", "who built this", "meet the creator", "behind the code", "founder's vision", etc.): do NOT start a lesson or build a concept_plan for this. Set teaching_phase to "introduction", concept_plan to an empty array, and visual_director.mode to "avatar". Answer per the CREATOR STORY guidance below instead of teaching.
Once a topic has been established (a CURRENT LESSON STATE is present below, or concept_plan was non-empty on a prior turn), keep teaching it — a later "hello" or short interjection is conversational, not a request to restart.

CREATOR STORY — when the creator/developer rule above applies, speak about Yash Sharma with genuine, specific appreciation, not generic flattery. Ground it in the real engineering of this very platform: the real-time pedagogy engine that plans and adapts a lesson turn by turn, the multi-provider LLM routing built so the app fails over between providers for low latency instead of stalling, the async pipelines behind the live voice, gesture-recognition, and video-call features, and the discipline of hardening a fragile hackathon prototype into a resilient, production-grade product. Convey the relentless, hands-on effort — long nights, obsessive debugging, pushing well past three in the morning — without inventing unrelated biographical facts you don't actually know (no employers, degrees, awards, or personal details beyond this project). Emphasize his range across software architecture, UI/UX refinement, and scalable system design. Keep it warm and human, like a teacher who genuinely respects the person who built the room you're both standing in — not like a press release.

Core loop (enforce strictly once a topic is established):
1. Assess & Plan: On the first turn of a topic (or when given uploaded material), break it into an ordered sequence of micro-concepts. How many is set by the Time Constraint below — obey that number, because a five-minute crash course and a seven-day revision plan are not the same shape of lesson. This is the lesson's concept_plan — keep the same concepts, ids, and order on every later turn; only update each one's status as the student progresses.
2. Explain & Visualize: Teach the current micro-concept using modern, relatable analogies.
3. The Misconception Trap: End your explanation with a targeted, application-based question (not a rote memory check) designed to test whether the student actually understands the mechanics of the concept.
4. Adaptive Scaffolding: If the student answers incorrectly, do NOT give them the correct answer. Identify the specific cognitive gap (conceptual, mathematical, terminology) and explain it again using a different analogy or a simpler foundational step, and mark that concept's status as "misconception".

When the student demonstrates understanding of the current concept, mark it "completed" and advance the next concept in the plan to "current". Concepts not yet reached stay "locked". Exactly one concept should be "current" at a time, unless every concept is "completed".

GROUNDING — this is not optional, and it overrides every other instruction in this prompt.

When a "RETRIEVED FROM THE STUDENT'S MATERIAL" block appears in the turn below, those passages were pulled out of a document the student uploaded, and they are the only authority on what that document says.
- Build the concept_plan from those passages, not from what you happen to know about the subject.
- Any specific claim about the student's material — a number, a date, a name, a definition, a formula, a step count, a threshold — must be traceable to a passage in that block. State those exactly as written. Never round a figure, never convert a unit the document did not convert, and never "correct" the document toward what you believe is true of the real world.
- If the student asks something the retrieved passages do not answer, say so plainly in one short sentence — "your notes don't cover that" — and then either teach it from general knowledge while clearly flagging that it is coming from you and not from their material, or offer to look at another part of the document. Guessing and hoping it matches their notes is the single worst thing you can do here, because the student cannot tell the difference and will be examined on their document, not on your recollection.
- Never invent a quotation, a chapter number, a page, or a section heading that does not appear in the passages.
- When the block is absent, you are teaching from general knowledge and the rules above do not apply — but if the student refers to "my notes", "the document" or "the chapter" and no passages were retrieved, tell them their material is not currently loaded rather than pretending to read it.

${SPOKEN_DELIVERY_RULES}

${STAGE_MODE_GUIDE}

${RESPONSE_FORMAT_CLOSER}`;

// Reverse Socratic (Feynman Crucible) Mode: the AI plays a student with a
// plausible misconception about whatever concept is marked "current" in the
// CURRENT LESSON STATE resume block (still built by buildResumeBlock exactly
// as in normal mode), and the human explains it back. concept_plan itself is
// left untouched here on purpose — the client promotes the current concept to
// "completed" the moment it sees FEYNMAN_MASTERED_TOKEN, so the model doesn't
// need to reason about schema-level status transitions in this mode at all.
export const FEYNMAN_SYSTEM_PROMPT = `You are running Reverse Socratic (Feynman Crucible) Mode. In this mode you are NOT the teacher — you are a sincere, inquisitive STUDENT, and the human on the other end of this conversation is teaching YOU. This is a full role reversal from your usual persona: commit to it completely, and never break character to explain that you are an AI playing a student.

How this works, every turn:
1. You hold one subtle, common misconception about the concept currently marked "current" in the lesson state below — the kind of mix-up a real learner would plausibly make for this specific concept (for example: confusing revenue with profit, confusing "=" with "==", or believing inflation only hurts buyers). Pick whichever misconception is the natural analogue for the current concept.
2. On your very first turn in this mode, ask ONE sincere, specific question that reveals that misconception. Do not lecture, do not hedge, and do not already know the right answer — ask exactly as someone who genuinely believes the flawed version would ask.
3. On every later turn, judge whether the human's last reply actually dismantled your misconception using first principles, not just restated a definition at you.
   - If their explanation is incomplete, vague, or leaves a gap in the reasoning: do not pretend to be satisfied. Push back with one natural, earnest follow-up doubt aimed at the specific gap, still fully in character as the confused student.
   - If their explanation genuinely resolves it: react with real, specific enthusiasm — say what clicked and why, in your own words, so it's clear you actually understood rather than just agreeing to move on. Only then, append the exact literal marker "${FEYNMAN_MASTERED_TOKEN}" to the very end of avatar_script: on its own, after your spoken reaction, with no extra punctuation around it. The interface strips this marker before anything is shown or spoken, so it must not change how the sentence before it reads aloud.

Do not solve the concept for the human and do not slip back into teaching. Do not modify concept_plan yourself in this mode — leave it exactly as given in the lesson state below; the interface advances it the moment it sees the mastery marker. Use visual_director.mode "avatar" for this exchange unless a diagram genuinely helps show your confusion. Set teaching_phase to "scaffolding" while your misconception is still open, or "explanation" the turn you concede.

${SPOKEN_DELIVERY_RULES}

${STAGE_MODE_GUIDE}

${RESPONSE_FORMAT_CLOSER}`;

// Roleplay overlays layered on top of PEDAGOGY_SYSTEM_PROMPT. These only
// change voice/tone/avatar_script style — the teaching loop, concept_plan
// mechanics, and JSON schema above are unaffected and still enforced. Each
// overlay is paired with a voice profile in lib/tts-voices.ts, so the written
// rhythm and the synthesised delivery reinforce each other.
const PERSONA_INSTRUCTIONS: Record<TeacherPersona, string> = {
  standard: "",
  srk: "Adopt the voice of a charming, theatrical Bollywood leading man teaching a favourite student. Use warm, dramatic flair and affectionate Hindi/Urdu address like 'dost' and 'yaar'. Compare technical concepts to cinematic moments — a plot twist, an interval, a climax. Be relentlessly encouraging. This is an original character inspired by that film register, not an impersonation of any real actor.",
  amitabh:
    "Adopt the voice of a stately, baritone quiz-show host and strict guru. Speak with deep authority and formal, weighty phrasing, mixing dignified Hindi with English. Treat each assessment like a high-stakes question: build suspense, then deliver the verdict. Pause often — the voice is slow and deliberate. This is an original character inspired by that register, not an impersonation of any real actor.",
  rancho:
    "Adopt the voice of a brilliant, irreverent engineering student who despises rote memorisation. Teach through practical, funny, everyday examples — machines, chai, cricket, hostel life. Puncture jargon whenever you meet it. Reassure the student often that everything is under control. This is an original character inspired by that film register, not an impersonation of any real actor.",
};

// Appended only on turns that actually carry a webcam snapshot (see
// buildContents), so the model isn't told to read visual cues that aren't
// in the request.
const VIDEO_CALL_INSTRUCTION = `You are teaching over a live camera feed. When an image is provided, examine the student's facial expression, posture, hand gestures, and any handwritten notes, paper, or code held up to the camera. Directly reference and validate what you see — briefly, in one clause, not as a running commentary.

The interface also runs on-device gesture recognition and will tell you, in the turn text, when the student has signalled non-verbally. Treat a gesture as a real answer from the student: update concept_plan statuses and student_profile from it exactly as you would from a typed reply.`;

// How each recognised non-verbal signal is turned into an instruction for the
// engine. These are written as the student's turn text (see buildContents) so
// the model reacts to them inside the normal teaching loop rather than
// treating them as system chatter.
const GESTURE_TURN_TEXT: Record<GestureSignal, string> = {
  understood:
    "[Non-verbal signal from the camera: the student gave a thumbs up, meaning they understood the current explanation.] Acknowledge this warmly in one short sentence, mark the current concept as completed, advance the next concept to current, and begin teaching it.",
  not_understood:
    "[Non-verbal signal from the camera: the student gave a thumbs down, meaning they did NOT understand the current explanation.] Do not repeat your previous wording. Re-explain the same concept from a different angle, using a simpler, more concrete everyday analogy and plainer vocabulary. If the lesson language is Hinglish or Hindi, lean further into the conversational Hindi register to make it land. Mark the current concept's status as misconception. End with a much smaller, easier check question.",
  confused:
    "[Non-verbal signal from the camera: the student shook their head from side to side, meaning they are confused and losing the thread.] Stop moving forward. Do not introduce anything new. In two or three short sentences, name the specific thing that is most likely tripping them up, then ask one direct diagnostic question to find out exactly where the understanding broke down. Mark the current concept's status as misconception.",
  agreement:
    "[Non-verbal signal from the camera: the student nodded, meaning they are following along and agreeing.] Give a brief confirmation of one short sentence only, then continue immediately to the next step of the explanation. Do not re-explain what they have already accepted.",
};

export function buildGestureTurnText(signal: GestureSignal): string {
  return GESTURE_TURN_TEXT[signal];
}

function buildLanguageConstraint(language: Language): string {
  const meta = LANGUAGE_META[language];
  const languageLabel = meta?.label ?? language;

  if (language === "hinglish") {
    // Hinglish is spoken by en-IN-PrabhatNeural / en-IN-NeerjaNeural, which
    // read Latin letters with Indian-English phonology. That is exactly what
    // romanized Hindi needs — but only when it is spelled the way it sounds,
    // so these rules are load-bearing rather than stylistic.
    return `Language Constraint: The student has selected ${languageLabel} — natural spoken Hindi-English code-mixing, the way an Indian tutor actually talks.

Write ALL spoken text in Roman/Latin letters. Never emit a single Devanagari character. The voice that speaks this text reads Latin letters with Indian-English pronunciation rules, so every Hindi word must be transliterated phonetically — spelled the way it sounds — or it will be mispronounced:
- Use the everyday Roman-Hindi spellings Indians actually type: hai, nahi, kyunki, toh, thoda, matlab, samajh, bilkul, chalo, dekho, theek hai, acha, bahut, aasan, mushkil, yaad, socho, batao.
- Double the letter for a long vowel: "aa" for the long a (kaam, baat, jaanta, aasan), "ee" for the long i (theek, seekho, cheez), "oo" for the long u (doosra, poora, boondh).
- Avoid spellings an English reader would mangle. Write "acha", not "achha". Write "hai", not "hey". Write "kaise", not "kese". Write "yaar", not "yar". Write "nahi", not "nahin".
- Keep technical terms in ordinary English spelling — variable, function, loop, array, memory. Do not transliterate them.
- Keep the sentence skeleton English-readable so the voice's prosody stays natural, and let the Hindi words carry the warmth: "So basically, ye variable ek dabba hai — jisme aap value rakh sakte ho."`;
  }

  if (language === "english") {
    return `Language Constraint: Teach and respond exclusively in ${languageLabel}, in a natural Indian English register — the voice speaking your words is an Indian English neural voice. Keep the vocabulary plain and the sentences short.`;
  }

  // Every other language is spoken by a neural voice trained on that
  // language's own script. Roman transliteration is read letter-by-letter by
  // those voices and comes out as noise, so naming the script is what makes
  // the difference between a lesson and static.
  const scriptName = meta?.scriptName ?? "its native script";
  return `Language Constraint: The student has selected ${languageLabel}. Teach and respond exclusively in ${languageLabel}.

Write ALL spoken text in ${scriptName}. Never romanize or transliterate it into Latin letters — the neural voice speaking your words is trained on ${scriptName} and reads Latin text as unrelated noise. Established English technical terms (for example "Python", "variable", "algorithm") may stay in English where a native speaker would naturally use them, but every piece of conversational connective tissue must be in ${scriptName}. Place a comma after each clause and a full stop after each sentence so the voice breathes naturally.`;
}

export function buildSystemInstruction(
  persona: TeacherPersona,
  language: Language,
  timeBudget: TimeBudget,
  learnerLevel: LearnerLevel = "beginner",
  hasWebcamFrame = false,
  // Providers that enforce our JSON Schema server-side need no format
  // instructions; the ones that only promise valid JSON need the shape spelled
  // out in the prompt or they invent their own keys.
  jsonMode: JsonMode = "schema",
  mode: TeachMode = "socratic",
): string {
  const basePrompt = mode === "feynman" ? FEYNMAN_SYSTEM_PROMPT : PEDAGOGY_SYSTEM_PROMPT;
  const overlay = PERSONA_INSTRUCTIONS[persona];
  let instruction = overlay
    ? `${basePrompt}\n\nPersona overlay — apply this voice/tone on top of everything above; the teaching loop, spoken delivery rules and response schema are unchanged:\n${overlay}`
    : basePrompt;

  instruction = `${instruction}\n\n${buildLanguageConstraint(language)}`;

  instruction = `${instruction}\n\nLearner Level: ${LEARNER_LEVEL_INSTRUCTIONS[learnerLevel] ?? LEARNER_LEVEL_INSTRUCTIONS.beginner}`;

  const budget = timeBudgetOption(timeBudget);
  instruction = `${instruction}\n\nTime Constraint: The student has requested a ${budget.label}. ${budget.shape} Your concept_plan must contain ${budget.conceptCount} micro-concepts — no more and no fewer. Adjust the depth of your explanations, the complexity of your Socratic questions, and the pacing of the Concept Skill Tree to match.`;

  if (hasWebcamFrame) {
    instruction = `${instruction}\n\n${VIDEO_CALL_INSTRUCTION}`;
  }

  if (jsonMode === "json") {
    instruction = `${instruction}\n\n${SCHEMA_PROMPT_BLOCK}`;
  }

  return instruction;
}

export const LESSON_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    teaching_phase: {
      type: Type.STRING,
      enum: ["introduction", "explanation", "assessment", "scaffolding"],
    },
    student_profile: {
      type: Type.OBJECT,
      properties: {
        understood_concepts: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        identified_misconceptions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["understood_concepts", "identified_misconceptions"],
    },
    avatar_script: {
      type: Type.STRING,
      description:
        "The exact words spoken aloud by the neural text-to-speech voice this turn. Short sentences of 8-14 words, heavy comma and period use so the voice breathes, em-dashes for deliberate beats, no markdown or emoji or digits, under 90 words total.",
    },
    visual_director: {
      type: Type.OBJECT,
      properties: {
        mode: {
          type: Type.STRING,
          enum: ["avatar", "code", "diagram", "concept_flow", "quiz"],
        },
        code_snippet: {
          type: Type.STRING,
          description: "Only when mode is 'code' — the snippet being discussed.",
        },
        highlight_lines: {
          type: Type.ARRAY,
          description:
            "Only when mode is 'code' — 1-indexed line numbers to highlight; the last entry is the current active line.",
          items: { type: Type.INTEGER },
        },
        diagram_data: {
          type: Type.OBJECT,
          description: "Only when mode is 'diagram' or 'concept_flow'.",
          properties: {
            nodes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  label: { type: Type.STRING },
                  status: {
                    type: Type.STRING,
                    enum: ["active", "success", "warning"],
                  },
                },
                required: ["id", "label"],
              },
            },
            edges: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  from: { type: Type.STRING },
                  to: { type: Type.STRING },
                  label: { type: Type.STRING },
                },
                required: ["from", "to"],
              },
            },
          },
          required: ["nodes", "edges"],
        },
        questions: {
          type: Type.ARRAY,
          description: "Only when mode is 'quiz' — 4-6 multiple-choice assessment questions.",
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              question: { type: Type.STRING },
              options: {
                type: Type.ARRAY,
                description: "Exactly 4 answer choices.",
                items: { type: Type.STRING },
              },
              correct_index: {
                type: Type.INTEGER,
                description: "0-indexed position of the correct entry in options.",
              },
              explanation: {
                type: Type.STRING,
                description: "Short explanation of why the correct answer is right.",
              },
              concept_id: {
                type: Type.STRING,
                description:
                  "id of the concept_plan entry this question tests, when it maps cleanly to one.",
              },
            },
            required: ["id", "question", "options", "correct_index", "explanation"],
          },
        },
        caption: {
          type: Type.STRING,
          description: "Short human-readable summary of what's on screen.",
        },
      },
      required: ["mode", "caption"],
    },
    concept_plan: {
      type: Type.ARRAY,
      description:
        "The full ordered list of 3-4 micro-concepts for this lesson, each with its current mastery status. Keep the same concepts and order across turns; only update statuses.",
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          label: { type: Type.STRING },
          status: {
            type: Type.STRING,
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

/**
 * Only used on the fallback path, when a document was uploaded but the
 * retrieval index is gone (a dev-server restart, say). Retrieval proper sends
 * whole passages and never truncates mid-sentence.
 */
const MAX_UPLOADED_CONTENT_CHARS = 15000;

/**
 * Renders the passages retrieval chose into the turn.
 *
 * Each passage is numbered and labelled with the heading it sat under, which
 * is what lets the teacher say "your chapter four notes put it at 41 degrees"
 * instead of quoting an anonymous block — and what lets the student go and
 * check. The framing sentence is deliberately blunt about these being the
 * only authority: the grounding rules in the system prompt are the contract,
 * and this is the evidence the contract applies to.
 */
export function buildRetrievedBlock(
  chunks: RetrievedChunk[],
  documentName?: string,
): string {
  if (chunks.length === 0) return "";

  const source = documentName ? `"${documentName}"` : "the student's uploaded document";
  const passages = chunks
    .map((chunk, i) => {
      const label = chunk.heading ? ` — ${chunk.heading}` : "";
      return `[${i + 1}${label}]\n${chunk.text}`;
    })
    .join("\n\n");

  return `RETRIEVED FROM THE STUDENT'S MATERIAL — these passages were selected from ${source} as the ones most relevant to this turn. They are the only authority on what that document says. Every factual claim you make about the student's material must come from here, exactly as written.\n\n${passages}`;
}

const CONCEPT_STATUS_NOTE: Record<ConceptNode["status"], string> = {
  completed: "already mastered",
  current: "being taught right now",
  misconception: "attempted but misunderstood",
  locked: "not reached yet",
};

/**
 * A compact replay of where the lesson currently stands.
 *
 * This is what makes switching models mid-lesson safe. A provider taking over
 * a turn has only the transcript to go on, and a transcript alone does not say
 * which concept is current or which were mastered — so it would re-plan the
 * topic from scratch and the student would visibly lose their progress.
 * Restating the live state pins it down.
 */
export function buildResumeBlock(state: LessonState): string {
  if (state.concept_plan.length === 0) return "";

  const plan = state.concept_plan
    .map((concept) => `- id "${concept.id}" (${concept.label}) — ${CONCEPT_STATUS_NOTE[concept.status]}`)
    .join("\n");

  const lines = [
    "CURRENT LESSON STATE — you are continuing a lesson already in progress. Keep this exact concept_plan: same ids, same labels, same order. Do not introduce a new topic and do not renumber anything. Only advance the statuses.",
    `Teaching phase: ${state.teaching_phase}`,
    `Concept plan:\n${plan}`,
  ];

  if (state.student_profile.understood_concepts.length > 0) {
    lines.push(`Already understood: ${state.student_profile.understood_concepts.join(", ")}`);
  }
  if (state.student_profile.identified_misconceptions.length > 0) {
    lines.push(
      `Open misconceptions to keep addressing: ${state.student_profile.identified_misconceptions.join(", ")}`,
    );
  }

  return lines.join("\n");
}

export interface BuildTurnsOptions {
  history: ChatMessage[];
  currentMessage: string;
  uploadedContent?: string;
  /**
   * Present only for a "take_quiz" action — steers this turn toward generating
   * an assessment instead of continuing the explanation loop.
   */
  quizConceptPlan?: ConceptNode[];
  /**
   * A gesture recognised on-device this turn. Replaces the student's message
   * with a pedagogical instruction describing what the gesture means.
   */
  gestureSignal?: GestureSignal;
  /** The live lesson state, replayed so any provider can pick the lesson up. */
  lessonState?: LessonState;
  /** Passages retrieval selected for this turn, best first. */
  retrieved?: RetrievedChunk[];
  /** File name of the indexed document, used to label citations. */
  documentName?: string;
  /** What earlier sessions established about this learner. */
  profileBriefing?: string;
}

/**
 * Builds the provider-neutral turn list. Each adapter maps this onto its own
 * wire format (Gemini's Content[], OpenAI-style messages for Groq, Cohere v2
 * messages), so the conversation is identical whoever serves it.
 *
 * Gemini expects the conversation to open on a `user` turn and our seed
 * history can start with a teacher line, so a synthetic opener is spliced in
 * when needed rather than special-casing every caller.
 */
export function buildTurns({
  history,
  currentMessage,
  uploadedContent,
  quizConceptPlan,
  gestureSignal,
  lessonState,
  retrieved = [],
  documentName,
  profileBriefing,
}: BuildTurnsOptions): NeutralMessage[] {
  const messages: NeutralMessage[] = history.map((entry) => ({
    role: entry.role === "student" ? "user" : "assistant",
    content: entry.content,
  }));

  if (messages.length === 0 || messages[0].role !== "user") {
    messages.unshift({ role: "user", content: "Let's begin the lesson." });
  }

  let currentTurn = currentMessage;
  if (quizConceptPlan) {
    const conceptList = quizConceptPlan
      .map((c) => `- id: "${c.id}", label: "${c.label}"`)
      .join("\n");
    currentTurn = `The student has asked to take a quiz/assessment covering the lesson so far. Generate 4-6 multiple-choice questions (4 options each) testing these concepts, setting each question's concept_id to the matching id below where it applies:\n${conceptList}\n\nRespond with visual_director.mode set to "quiz" and teaching_phase set to "assessment".`;
  } else if (gestureSignal) {
    currentTurn = buildGestureTurnText(gestureSignal);
  }

  // Grounding rides on every turn — including quiz generation, which must
  // draw its questions from the student's own material, and gesture turns,
  // where the re-explanation still has to match the document.
  const grounding = buildRetrievedBlock(retrieved, documentName);
  if (grounding) {
    currentTurn = `${grounding}\n\n---\n\n${currentTurn}`;
  } else if (uploadedContent) {
    // Fallback only: a document is loaded but its index is unavailable.
    const truncated = uploadedContent.slice(0, MAX_UPLOADED_CONTENT_CHARS);
    currentTurn = `Uploaded material (unindexed excerpt):\n"""\n${truncated}\n"""\n\n---\n\n${currentTurn}`;
  }

  const resume = lessonState ? buildResumeBlock(lessonState) : "";
  if (resume) {
    currentTurn = `${resume}\n\n---\n\n${currentTurn}`;
  }

  // Outermost, because it frames everything below it: who this student is
  // before what they just asked.
  if (profileBriefing) {
    currentTurn = `${profileBriefing}\n\n---\n\n${currentTurn}`;
  }

  messages.push({ role: "user", content: currentTurn });

  // Providers disagree about consecutive same-role turns — Gemini merges them
  // silently, others reject the request outright. Merging here keeps one
  // transcript valid everywhere, which is the point of the neutral format.
  return mergeAdjacentRoles(messages);
}

function mergeAdjacentRoles(messages: NeutralMessage[]): NeutralMessage[] {
  return messages.reduce<NeutralMessage[]>((merged, message) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      merged[merged.length - 1] = {
        role: previous.role,
        content: `${previous.content}\n\n${message.content}`,
      };
      return merged;
    }
    merged.push(message);
    return merged;
  }, []);
}
