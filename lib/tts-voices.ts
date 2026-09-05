import { LANGUAGE_META, type Language, type TeacherPersona, type VoiceGender } from "./types";

// Microsoft Edge neural voices, reachable through msedge-tts without an API
// key. Which voice speaks a turn is decided entirely by LANGUAGE_META in
// lib/types.ts — one table, so a language can never end up with a picker
// label, a script instruction and a voice that disagree with each other.
//
// The one rule worth stating out loud: a voice is trained on a script, not on
// a language name. hi-IN-MadhurNeural reads Devanagari beautifully and
// mangles romanised Hindi; en-IN-PrabhatNeural does the exact opposite. That
// is why Hindi and Hinglish are separate rows pointing at different voices,
// and why the prompt is told the script name rather than left to guess.

export interface VoiceProfile {
  /** Edge neural voice short name, e.g. "hi-IN-MadhurNeural". */
  voice: string;
  /** SSML prosody rate, e.g. "-8%". Kept inside -5%..-10% for clarity. */
  rate: string;
  /** SSML prosody pitch, e.g. "-4Hz". */
  pitch: string;
  /** SSML prosody volume. */
  volume: string;
}

interface PersonaVoiceCharacter {
  /** Character personas are written male; only "standard" is switchable. */
  fixedGender: VoiceGender | null;
  rate: string;
  pitch: string;
  volume: string;
}

// Rate stays within the -5%..-10% clarity band for every persona — neural
// voices articulate consonant clusters and English technical terms noticeably
// better just below their default rate. Pitch carries the character: a deep,
// slow guru vs. a bright, quick rebel.
const PERSONA_VOICE_CHARACTERS: Record<TeacherPersona, PersonaVoiceCharacter> = {
  standard: { fixedGender: null, rate: "-8%", pitch: "+0Hz", volume: "+0%" },
  srk: { fixedGender: "male", rate: "-6%", pitch: "+6Hz", volume: "+8%" },
  amitabh: { fixedGender: "male", rate: "-10%", pitch: "-14Hz", volume: "+12%" },
  rancho: { fixedGender: "male", rate: "-5%", pitch: "+10Hz", volume: "+6%" },
};

/**
 * Spoken by en-IN, which is the safe harbour for any language whose own voice
 * the Edge endpoint declines to serve. Latin-script languages degrade to this
 * with an accent; non-Latin ones will not sound right, which is why the route
 * only reaches for it after the real voice has actually failed.
 */
export const FALLBACK_VOICE_MALE = "en-IN-PrabhatNeural";
export const FALLBACK_VOICE_FEMALE = "en-IN-NeerjaNeural";

function selectVoice(language: Language, gender: VoiceGender): string {
  const meta = LANGUAGE_META[language];
  if (!meta) {
    // Unknown language id from an older client — speak it rather than 500.
    return gender === "female" ? FALLBACK_VOICE_FEMALE : FALLBACK_VOICE_MALE;
  }
  return gender === "female" ? meta.voiceFemale : meta.voiceMale;
}

export function resolveVoiceGender(
  persona: TeacherPersona,
  requested: VoiceGender,
): VoiceGender {
  return PERSONA_VOICE_CHARACTERS[persona]?.fixedGender ?? requested;
}

export function resolveVoiceProfile(
  persona: TeacherPersona,
  language: Language,
  requestedGender: VoiceGender,
): VoiceProfile {
  const character = PERSONA_VOICE_CHARACTERS[persona] ?? PERSONA_VOICE_CHARACTERS.standard;
  const gender = character.fixedGender ?? requestedGender;
  return {
    voice: selectVoice(language, gender),
    rate: character.rate,
    pitch: character.pitch,
    volume: character.volume,
  };
}

/** The en-IN profile to retry with when a language's own voice is unavailable. */
export function fallbackVoiceProfile(profile: VoiceProfile, gender: VoiceGender): VoiceProfile {
  return {
    ...profile,
    voice: gender === "female" ? FALLBACK_VOICE_FEMALE : FALLBACK_VOICE_MALE,
  };
}

// Edge's SSML parser treats these as markup, and the neural voices read stray
// markdown punctuation aloud ("asterisk", "hash"). The engine is instructed
// not to emit any of it, but a stray character from a persona flourish or an
// uploaded-document quote would otherwise break synthesis outright.
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/&/g, " and ")
    .replace(/[<>]/g, " ")
    .replace(/[*_`#|~]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
