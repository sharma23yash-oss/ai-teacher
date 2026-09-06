import "server-only";
import type { LessonPayload } from "@/lib/types";

/**
 * Post-processing pass over a parsed lesson payload, applied once per turn
 * regardless of which provider served it. Two independent checks:
 *
 * 1. PII redaction — a student's uploaded material, a webcam frame, or a
 *    model hallucination could put a real email address or phone number into
 *    the spoken/visible output. Matches are replaced, never merely logged.
 * 2. System-prompt leak detection — a lightweight verbatim-overlap check
 *    against the exact system instruction sent for this turn. This is a
 *    second, content-based line of defense alongside the canary token (see
 *    lib/security/canary.ts): the canary catches a leak of *that one marker*
 *    specifically, this catches a leak of the surrounding prompt wording even
 *    when the model paraphrases around the marker or the marker itself was
 *    stripped by the model.
 *
 * Both are deliberately conservative — a false negative here just means the
 * canary/other layers are the backstop, but a false positive would silently
 * mangle a genuine lesson, which is worse for a teaching product.
 */

// Requires phone-number-shaped punctuation (separators between digit groups)
// rather than matching any run of digits, so ordinary numeric lesson content
// — years, physics constants, equation answers — is left alone.
const PHONE_PATTERN =
  /(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]\d{3,4}[-.\s]\d{3,4}(?:[-.\s]\d{2,4})?\b/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function redactPii(text: string): string {
  return text.replace(EMAIL_PATTERN, "[redacted email]").replace(PHONE_PATTERN, "[redacted phone number]");
}

// Word-shingle overlap: exact-match runs of SHINGLE_SIZE consecutive words,
// case- and whitespace-normalized. Long enough that a coincidental match on
// ordinary teaching language is very unlikely, short enough to catch a
// paraphrase-free leak of even one system-prompt sentence.
const SHINGLE_SIZE = 8;

function wordShingles(text: string): string[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < SHINGLE_SIZE) return [];
  const shingles: string[] = [];
  for (let i = 0; i + SHINGLE_SIZE <= words.length; i++) {
    shingles.push(words.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return shingles;
}

function leaksSystemPrompt(candidate: string, promptShingles: Set<string>): boolean {
  if (promptShingles.size === 0) return false;
  return wordShingles(candidate).some((shingle) => promptShingles.has(shingle));
}

const LEAK_FALLBACK_SCRIPT =
  "Sorry, let's get back on track. Can you tell me what you understood so far?";
const LEAK_FALLBACK_CAPTION = "Continuing the lesson.";
const LEAK_FALLBACK_TEXT = "[removed]";

/**
 * Sanitizes one free-text field. Leak detection replaces the whole field
 * (a partial excision of just the matching words tends to leave a mangled,
 * half-sentence result — worse for the student than a clean generic line)
 * with the caller-supplied fallback; PII redaction only ever touches the
 * specific matched substring.
 */
function sanitizeField(
  text: string | undefined,
  promptShingles: Set<string>,
  fallback: string,
): string | undefined {
  if (text === undefined) return text;
  if (leaksSystemPrompt(text, promptShingles)) {
    console.warn("[security] system-prompt leak detected in model output; field replaced.");
    return fallback;
  }
  return redactPii(text);
}

export function sanitizeLessonPayload(
  payload: LessonPayload,
  systemInstruction: string,
): LessonPayload {
  const promptShingles = new Set(wordShingles(systemInstruction));

  const avatar_script =
    sanitizeField(payload.avatar_script, promptShingles, LEAK_FALLBACK_SCRIPT) ??
    payload.avatar_script;

  const caption =
    sanitizeField(payload.visual_director.caption, promptShingles, LEAK_FALLBACK_CAPTION) ??
    payload.visual_director.caption;

  const questions = payload.visual_director.questions?.map((question) => ({
    ...question,
    question: sanitizeField(question.question, promptShingles, LEAK_FALLBACK_TEXT) ?? question.question,
    options: question.options.map(
      (option) => sanitizeField(option, promptShingles, LEAK_FALLBACK_TEXT) ?? option,
    ),
    explanation:
      sanitizeField(question.explanation, promptShingles, LEAK_FALLBACK_TEXT) ??
      question.explanation,
  }));

  return {
    ...payload,
    avatar_script,
    visual_director: {
      ...payload.visual_director,
      caption,
      ...(questions ? { questions } : {}),
    },
  };
}
