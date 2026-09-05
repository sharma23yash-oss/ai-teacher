import type { TeacherPersona, VoiceGender } from "./types";

export type HairStyle = "neat" | "swept" | "silver" | "messy" | "long";
export type FacialHair = "none" | "stubble" | "grey-beard";

export interface AvatarTheme {
  /** Warm Indian skin tones — base fill plus the two gradient stops. */
  skinLight: string;
  skinBase: string;
  skinShadow: string;
  blush: string;
  hair: string;
  hairHighlight: string;
  hairStyle: HairStyle;
  brow: string;
  /** Iris gradient, light centre to dark rim, plus the limbal ring. */
  irisLight: string;
  irisDark: string;
  limbalRing: string;
  facialHair: FacialHair;
  glasses: boolean;
  lipBase: string;
  lipShadow: string;
  collar: string;
  jacket: string;
  accent: string;
  /** Radial backdrop behind the bust, from centre to edge. */
  backdropInner: string;
  backdropOuter: string;
  /** Short label shown under the avatar on the full-size stage. */
  title: string;
}

// Every persona is an original character. The two "filmi" personas are drawn
// as archetypes — a warm theatrical storyteller and a silver-haired quiz
// master — rather than as portraits of any real actor.
const MALE_THEMES: Record<TeacherPersona, AvatarTheme> = {
  standard: {
    skinLight: "#e8b98c",
    skinBase: "#cf9764",
    skinShadow: "#a97243",
    blush: "#c97a63",
    hair: "#1c1917",
    hairHighlight: "#3f3a36",
    hairStyle: "neat",
    brow: "#171310",
    // The requested blue-grey eyes: a pale centre so the iris still reads at
    // picture-in-picture size, ringed dark so it holds shape at full size.
    irisLight: "#bcd9ef",
    irisDark: "#3d6f9e",
    limbalRing: "#1b3a52",
    facialHair: "stubble",
    glasses: true,
    lipBase: "#a9634f",
    lipShadow: "#7c4436",
    collar: "#f8fafc",
    jacket: "#4338ca",
    accent: "#818cf8",
    backdropInner: "#1e1b4b",
    backdropOuter: "#020617",
    title: "Standard Educator",
  },
  srk: {
    skinLight: "#e9b485",
    skinBase: "#cd8f5c",
    skinShadow: "#a26a3c",
    blush: "#c96a54",
    hair: "#221410",
    hairHighlight: "#4a2c1f",
    hairStyle: "swept",
    brow: "#1a0f0b",
    irisLight: "#d8c3a8",
    irisDark: "#6b4423",
    limbalRing: "#2e1c0f",
    facialHair: "stubble",
    glasses: false,
    lipBase: "#ab5c48",
    lipShadow: "#7d3c2e",
    collar: "#fef2f2",
    jacket: "#9f1239",
    accent: "#fb7185",
    backdropInner: "#4c0519",
    backdropOuter: "#0b0407",
    title: "Charming Storyteller",
  },
  amitabh: {
    skinLight: "#dfae86",
    skinBase: "#c08a5d",
    skinShadow: "#94663f",
    blush: "#b06a52",
    hair: "#4b4b4b",
    hairHighlight: "#7b7b7b",
    hairStyle: "silver",
    brow: "#5b5550",
    irisLight: "#c9b79c",
    irisDark: "#57422b",
    limbalRing: "#241a10",
    facialHair: "grey-beard",
    glasses: true,
    lipBase: "#9c5a48",
    lipShadow: "#6f3a2c",
    collar: "#e2e8f0",
    jacket: "#1e293b",
    accent: "#94a3b8",
    backdropInner: "#1e293b",
    backdropOuter: "#020617",
    title: "Strict Guru",
  },
  rancho: {
    skinLight: "#eebd8f",
    skinBase: "#d29a66",
    skinShadow: "#a97445",
    blush: "#cf7f5f",
    hair: "#241611",
    hairHighlight: "#4d3020",
    hairStyle: "messy",
    brow: "#1c1109",
    irisLight: "#c8b191",
    irisDark: "#5f4527",
    limbalRing: "#2a1d10",
    facialHair: "none",
    glasses: false,
    lipBase: "#b06451",
    lipShadow: "#834537",
    collar: "#fefce8",
    jacket: "#ca8a04",
    accent: "#fde047",
    backdropInner: "#422006",
    backdropOuter: "#0a0703",
    title: "Practical Rebel",
  },
};

// Only the neutral "standard" educator is switchable; the three character
// personas are written and voiced male, so their theme is unchanged.
const STANDARD_FEMALE: AvatarTheme = {
  ...MALE_THEMES.standard,
  hairStyle: "long",
  facialHair: "none",
  glasses: false,
  lipBase: "#b9604f",
  lipShadow: "#8a3f31",
  skinLight: "#efc296",
  skinBase: "#d69c69",
  skinShadow: "#ad7648",
  title: "Standard Educator",
};

export function resolveAvatarTheme(
  persona: TeacherPersona,
  voiceGender: VoiceGender,
): AvatarTheme {
  if (persona === "standard" && voiceGender === "female") return STANDARD_FEMALE;
  return MALE_THEMES[persona];
}
