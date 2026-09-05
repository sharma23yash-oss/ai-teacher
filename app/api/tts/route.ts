import type { Readable } from "stream";
import { NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import {
  LANGUAGES,
  TEACHER_PERSONAS,
  VOICE_GENDERS,
  type Language,
  type TeacherPersona,
  type TtsErrorBody,
  type VoiceGender,
} from "@/lib/types";
import { resolveVoiceProfile, sanitizeForSpeech } from "@/lib/tts-voices";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 2000;
// A single turn is a few seconds of speech; anything beyond this means the
// upstream socket has stalled rather than that the text was unusually long.
const SYNTHESIS_TIMEOUT_MS = 20_000;

const BAD_REQUEST_MESSAGE =
  "Expected { text: string, persona: TeacherPersona, language: Language, voiceGender: VoiceGender }.";

function isTeacherPersona(value: unknown): value is TeacherPersona {
  return typeof value === "string" && (TEACHER_PERSONAS as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

function isVoiceGender(value: unknown): value is VoiceGender {
  return typeof value === "string" && (VOICE_GENDERS as readonly string[]).includes(value);
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      stream.destroy();
      reject(new Error("Edge TTS synthesis timed out."));
    }, SYNTHESIS_TIMEOUT_MS);

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json<TtsErrorBody>(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (typeof rawBody !== "object" || rawBody === null) {
    return NextResponse.json<TtsErrorBody>({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }
  const { text, persona, language, voiceGender } = rawBody as Record<string, unknown>;

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json<TtsErrorBody>({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }
  if (!isTeacherPersona(persona)) {
    return NextResponse.json<TtsErrorBody>({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }
  if (!isLanguage(language)) {
    return NextResponse.json<TtsErrorBody>({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }
  // Older clients that predate the voice switcher fall back to the persona's
  // own default rather than being rejected outright.
  const requestedGender: VoiceGender = isVoiceGender(voiceGender) ? voiceGender : "male";

  const speechText = sanitizeForSpeech(text).slice(0, MAX_TEXT_CHARS);
  if (!speechText) {
    return NextResponse.json<TtsErrorBody>(
      { error: "Nothing speakable left after sanitising the text." },
      { status: 400 },
    );
  }

  const profile = resolveVoiceProfile(persona, language, requestedGender);

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(profile.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(speechText, {
      rate: profile.rate,
      pitch: profile.pitch,
      volume: profile.volume,
    });
    const audioBuffer = await streamToBuffer(audioStream);

    if (audioBuffer.byteLength === 0) {
      return NextResponse.json<TtsErrorBody>(
        { error: "Edge TTS returned an empty audio stream." },
        { status: 502 },
      );
    }

    return new NextResponse(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "no-store",
        "X-Tts-Voice": profile.voice,
        "X-Tts-Rate": profile.rate,
      },
    });
  } catch (error) {
    // The client treats any non-2xx as "use the browser fallback voice", so a
    // warn here is enough — this is an expected degradation, not a crash.
    console.warn(
      "Edge TTS synthesis failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json<TtsErrorBody>(
      { error: "Speech synthesis is unavailable right now." },
      { status: 502 },
    );
  } finally {
    try {
      tts.close();
    } catch {
      // close() throws when the socket never opened — nothing to clean up.
    }
  }
}
