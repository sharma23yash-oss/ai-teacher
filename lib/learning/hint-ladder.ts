/**
 * The hint ladder: four rungs of help, each giving away more than the last.
 *
 *   0 none          — the student answered on their own
 *   1 nudge         — a question that points at the right idea
 *   2 hint          — names the relevant rule or fact, no working
 *   3 worked_step   — shows the first step of the solution
 *   4 full_solution — the complete answer with reasoning
 *
 * The rung used is recorded with the student's next answer, and a correct
 * answer earns less mastery credit the higher the rung (see HINT_CREDIT).
 */

export const HINT_LEVELS = ["none", "nudge", "hint", "worked_step", "full_solution"] as const;
export type HintLevelName = (typeof HINT_LEVELS)[number];

/** 0 (no help) to 4 (full solution). */
export type HintLevel = 0 | 1 | 2 | 3 | 4;

export const MAX_HINT_LEVEL: HintLevel = 4;

/**
 * Share of full credit a correct answer earns at each rung. Reading the full
 * solution and then repeating it shows very little, so it earns very little.
 */
export const HINT_CREDIT: Record<HintLevel, number> = {
  0: 1,
  1: 0.85,
  2: 0.65,
  3: 0.4,
  4: 0.15,
};

/** Button text for asking for the *next* rung. */
export const HINT_BUTTON_LABEL: Record<Exclude<HintLevel, 0>, string> = {
  1: "Nudge me",
  2: "Give me a hint",
  3: "Show me a step",
  4: "Show the solution",
};

/** What the student sees in the transcript when they ask. */
export const HINT_REQUEST_TEXT: Record<Exclude<HintLevel, 0>, string> = {
  1: "💡 Nudge me in the right direction",
  2: "💡 Give me a hint",
  3: "💡 Show me the first step",
  4: "💡 Show me the full solution",
};

/** Instruction appended to the system prompt for a hint turn. */
export const HINT_INSTRUCTION: Record<Exclude<HintLevel, 0>, string> = {
  1: "The student asked for a NUDGE on the question you last asked. Reply with one short guiding question or observation that points them toward the key idea. Do NOT state the rule, the method or the answer. Keep the concept status unchanged and end by inviting them to try again.",
  2: "The student asked for a HINT on the question you last asked. Name the specific rule, formula or fact they need, in one or two sentences, without applying it or doing any working. Do NOT give the answer. Keep the concept status unchanged and invite them to try again.",
  3: "The student asked to see a WORKED STEP for the question you last asked. Show only the first step of the solution, with one line explaining why, then ask them to complete the rest. Do NOT give the final answer. Keep the concept status unchanged.",
  4: "The student asked for the FULL SOLUTION to the question you last asked. Walk through the complete solution step by step, explain the reasoning, then ask one new, similar check question so they can show they now understand it. Keep the concept status as current until they answer that new question correctly.",
};

export function clampHintLevel(level: number): HintLevel {
  if (!Number.isFinite(level) || level <= 0) return 0;
  if (level >= MAX_HINT_LEVEL) return MAX_HINT_LEVEL;
  return Math.floor(level) as HintLevel;
}

/** The rung the next hint request should ask for, or null when the ladder is exhausted. */
export function nextHintLevel(current: HintLevel): Exclude<HintLevel, 0> | null {
  if (current >= MAX_HINT_LEVEL) return null;
  return (current + 1) as Exclude<HintLevel, 0>;
}

export function hintCredit(level: HintLevel): number {
  return HINT_CREDIT[clampHintLevel(level)];
}

export function hintLevelName(level: HintLevel): HintLevelName {
  return HINT_LEVELS[clampHintLevel(level)];
}
