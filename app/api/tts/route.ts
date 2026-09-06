import type { Readable } from "stream";
import { NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { TtsErrorBody } from "@/lib/types";
import { formatZodError, ttsRequestSchema } from "@/lib/schemas";
import {
  fallbackVoiceProfile,
  resolveVoiceGender,
  resolveVoiceProfile,
  sanitizeForSpeech,
  type VoiceProfile,
} from "@/lib/tts-voices";

export const runtime = "nodejs";

// A single turn is a few seconds of speech; anything beyond this means the
// upstream socket has stalled rather than that the text was unusually long.
const SYNTHESIS_TIMEOUT_MS = 20_000;

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

/**
 * One synthesis attempt against one voice. Each attempt gets its own
 * MsEdgeTTS instance: the socket is bound to the voice chosen in
 * setMetadata, so a retry on a different voice cannot reuse it.
 */
async function synthesize(profile: VoiceProfile, speechText: string): Promise<Buffer> {
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
      throw new Error("Edge TTS returned an empty audio stream.");
    }
    return audioBuffer;
  } finally {
    try {
      tts.close();
    } catch {
      // close() throws when the socket never opened — nothing to clean up.
    }
  }
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

  const parsedBody = ttsRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json<TtsErrorBody>(
      { error: formatZodError(parsedBody.error) },
      { status: 400 },
    );
  }
  const { text, persona, language, voiceGender: requestedGender } = parsedBody.data;

  const speechText = sanitizeForSpeech(text);
  if (!speechText) {
    return NextResponse.json<TtsErrorBody>(
      { error: "Nothing speakable left after sanitising the text." },
      { status: 400 },
    );
  }

  const profile = resolveVoiceProfile(persona, language, requestedGender);
  const effectiveGender = resolveVoiceGender(persona, requestedGender);

  // Two attempts, never more. The app now offers nineteen teaching languages,
  // and if Edge ever retires one of their voices the correct behaviour is a
  // lesson that still speaks — accented, but audible — rather than a silent
  // one. The header says which voice actually spoke so a wrong-sounding turn
  // is diagnosable from the network tab instead of guesswork.
  let audioBuffer: Buffer | null = null;
  let usedProfile = profile;
  let degraded = false;

  try {
    audioBuffer = await synthesize(profile, speechText);
  } catch (primaryError) {
    console.warn(
      `Edge TTS failed on ${profile.voice}:`,
      primaryError instanceof Error ? primaryError.message : primaryError,
    );
    const fallback = fallbackVoiceProfile(profile, effectiveGender);
    if (fallback.voice !== profile.voice) {
      try {
        audioBuffer = await synthesize(fallback, speechText);
        usedProfile = fallback;
        degraded = true;
      } catch (fallbackError) {
        console.warn(
          `Edge TTS fallback failed on ${fallback.voice}:`,
          fallbackError instanceof Error ? fallbackError.message : fallbackError,
        );
      }
    }
  }

  if (!audioBuffer) {
    // The client treats any non-2xx as "use the browser fallback voice", so
    // this is an expected degradation, not a crash.
    return NextResponse.json<TtsErrorBody>(
      { error: "Speech synthesis is unavailable right now." },
      { status: 502 },
    );
  }

  return new NextResponse(new Uint8Array(audioBuffer), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.byteLength),
      "Cache-Control": "no-store",
      "X-Tts-Voice": usedProfile.voice,
      "X-Tts-Rate": usedProfile.rate,
      "X-Tts-Degraded": degraded ? "1" : "0",
    },
  });
}
