import type { Language, TeacherPersona, VoiceGender } from "./types";

// Microsoft Edge neural voices reachable through msedge-tts without an API
// key. Indian-locale voices are mandatory here: the default en-US voices
// pronounce romanized Hindi (Hinglish) as if it were English and flatten the
// Indian-English prosody the personas are written in.
export const EDGE_VOICES = {
  /** Indian English, female — natural Hinglish + Indian English delivery. */
  indianEnglishFemale: "en-IN-NeerjaNeural",
  /** Indian English, male — natural Hinglish + Indian English delivery. */
  indianEnglishMale: "en-IN-PrabhatNeural",
  /** Hindi, female — for Devanagari script only. */
  hindiFemale: "hi-IN-SwaraNeural",
  /** Hindi, male — for Devanagari script only. */
  hindiMale: "hi-IN-MadhurNeural",
} as const;

export type EdgeVoiceName = (typeof EDGE_VOICES)[keyof typeof EDGE_VOICES];

export interface VoiceProfile {
  voice: EdgeVoiceName;
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

// Rate stays within the -5%..-10% clarity band for every persona — Indian
// neural voices articulate consonant clusters and English technical terms
// noticeably better just below their default rate. Pitch carries the
// character: a deep, slow guru vs. a bright, quick rebel.
const PERSONA_VOICE_CHARACTERS: Record<TeacherPersona, PersonaVoiceCharacter> = {
  standard: { fixedGender: null, rate: "-8%", pitch: "+0Hz", volume: "+0%" },
  srk: { fixedGender: "male", rate: "-6%", pitch: "+6Hz", volume: "+8%" },
  amitabh: { fixedGender: "male", rate: "-10%", pitch: "-14Hz", volume: "+12%" },
  rancho: { fixedGender: "male", rate: "-5%", pitch: "+10Hz", volume: "+6%" },
};

// Hindi is the only language spoken from Devanagari, so it is the only one
// routed to the hi-IN voices. Hinglish is written in phonetic Latin script
// (see lib/pedagogy-engine.ts) and is spoken far more naturally by the en-IN
// voices, which read Roman letters with Indian-English phonology and keep
// English technical terms intact.
function selectVoice(language: Language, gender: VoiceGender): EdgeVoiceName {
  // Normalize the strings so "English" becomes "english" and "Male voice" is caught
  const lang = language.toLowerCase();
  const isMale = gender.toLowerCase().includes("male");

  if (lang === "hindi") {
    return isMale ? EDGE_VOICES.hindiMale : EDGE_VOICES.hindiFemale;
  }
  
  return isMale
    ? EDGE_VOICES.indianEnglishMale
    : EDGE_VOICES.indianEnglishFemale;
}

export function resolveVoiceGender(
  persona: TeacherPersona,
  requested: VoiceGender,
): VoiceGender {
  return PERSONA_VOICE_CHARACTERS[persona].fixedGender ?? requested;
}

export function resolveVoiceProfile(
  persona: TeacherPersona,
  language: Language,
  requestedGender: VoiceGender,
): VoiceProfile {
  const character = PERSONA_VOICE_CHARACTERS[persona];
  const gender = character.fixedGender ?? requestedGender;
  return {
    voice: selectVoice(language, gender),
    rate: character.rate,
    pitch: character.pitch,
    volume: character.volume,
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
