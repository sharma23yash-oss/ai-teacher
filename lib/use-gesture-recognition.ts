"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { FaceLandmarker, GestureRecognizer } from "@mediapipe/tasks-vision";
import type { GestureSignal } from "./types";

export type GestureEngineStatus = "idle" | "loading" | "ready" | "error";

export interface HeadPose {
  /** Degrees. Positive = turned to the student's left. */
  yaw: number;
  /** Degrees. Positive = chin up. */
  pitch: number;
  /** Degrees. Head roll. */
  roll: number;
}

export interface UseGestureRecognitionResult {
  status: GestureEngineStatus;
  error: string | null;
  /** True once a hand or face is actually visible in frame. */
  isTracking: boolean;
  /** The raw canned gesture currently held, e.g. "Thumb_Up". */
  rawGesture: string | null;
  headPose: HeadPose | null;
  /** The last signal emitted, for the HUD. */
  lastSignal: GestureSignal | null;
  /**
   * Increments on every emission, including a repeat of the same signal — use
   * it as a React key so the HUD animation replays each time.
   */
  lastSignalId: number;
  clearLastSignal: () => void;
}

export interface UseGestureRecognitionOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  /**
   * Suspends emission (but not tracking) — set while the teacher is speaking
   * or a turn is in flight, so a held thumbs-up doesn't queue five requests.
   */
  paused?: boolean;
  onSignal: (signal: GestureSignal) => void;
}

// The MediaPipe runtime is ~12MB of Wasm and the two task bundles are a few
// MB more, so nothing here is imported until a video call actually starts.
// Both are overridable for an offline demo: copy node_modules/@mediapipe/
// tasks-vision/wasm into public/ and point these at the local paths.
const WASM_BASE_PATH =
  process.env.NEXT_PUBLIC_MEDIAPIPE_WASM_PATH ??
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const GESTURE_MODEL_URL =
  process.env.NEXT_PUBLIC_MEDIAPIPE_GESTURE_MODEL ??
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const FACE_MODEL_URL =
  process.env.NEXT_PUBLIC_MEDIAPIPE_FACE_MODEL ??
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// --- Tuning -----------------------------------------------------------------
// A gesture must be held rather than flash past, or every hand that crosses
// the frame fires a teaching turn.
const GESTURE_MIN_SCORE = 0.62;
const GESTURE_HOLD_FRAMES = 9;
/** No two signals of any kind within this window. */
const SIGNAL_COOLDOWN_MS = 4000;

/** Rolling window of head-pose samples used for nod/shake detection. */
const POSE_WINDOW_MS = 1700;
const POSE_MIN_SAMPLES = 14;
/** Peak-to-peak degrees required before an oscillation counts. */
const SHAKE_MIN_AMPLITUDE_DEG = 11;
const NOD_MIN_AMPLITUDE_DEG = 8;
/** Direction reversals required — a nod is at least down-up-down. */
const MIN_REVERSALS = 2;
/** How much one axis must dominate the other to disambiguate nod vs. shake. */
const AXIS_DOMINANCE = 1.5;

interface PoseSample {
  t: number;
  yaw: number;
  pitch: number;
}

/**
 * Converts MediaPipe's 4x4 facial transformation matrix (column-major) into
 * head-pose Euler angles in degrees, using a Y-X-Z extraction. Only the
 * relative motion matters here, so the absolute sign convention is unimportant
 * as long as it is stable frame to frame.
 */
function matrixToHeadPose(data: number[]): HeadPose | null {
  if (data.length < 16) return null;
  // m[row][col] === data[col * 4 + row]
  const m02 = data[8];
  const m12 = data[9];
  const m22 = data[10];
  const m10 = data[1];
  const m11 = data[5];

  const clamped = Math.max(-1, Math.min(1, -m12));
  const toDeg = 180 / Math.PI;
  return {
    yaw: Math.atan2(m02, m22) * toDeg,
    pitch: Math.asin(clamped) * toDeg,
    roll: Math.atan2(m10, m11) * toDeg,
  };
}

interface OscillationStats {
  amplitude: number;
  reversals: number;
}

/**
 * Measures peak-to-peak swing and direction changes across a series. A nod or
 * a shake is exactly this: a large swing that reverses at least twice. A slow
 * drift (leaning in, glancing away) produces a large amplitude but no
 * reversals, so it is correctly ignored.
 */
function measureOscillation(series: number[]): OscillationStats {
  if (series.length < 3) return { amplitude: 0, reversals: 0 };

  let min = series[0];
  let max = series[0];
  for (const value of series) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  let reversals = 0;
  let lastDirection = 0;
  // Ignore jitter below this many degrees when deciding a direction changed.
  const noiseFloor = Math.max(1.4, (max - min) * 0.18);
  let anchor = series[0];

  for (let i = 1; i < series.length; i++) {
    const delta = series[i] - anchor;
    if (Math.abs(delta) < noiseFloor) continue;
    const direction = delta > 0 ? 1 : -1;
    if (lastDirection !== 0 && direction !== lastDirection) reversals += 1;
    lastDirection = direction;
    anchor = series[i];
  }

  return { amplitude: max - min, reversals };
}

/**
 * Runs MediaPipe GestureRecognizer and FaceLandmarker over the live webcam
 * feed entirely on-device, and translates what it sees into the four
 * pedagogical signals the teaching engine understands.
 */
export function useGestureRecognition({
  videoRef,
  enabled,
  paused = false,
  onSignal,
}: UseGestureRecognitionOptions): UseGestureRecognitionResult {
  const [status, setStatus] = useState<GestureEngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isTracking, setIsTracking] = useState(false);
  const [rawGesture, setRawGesture] = useState<string | null>(null);
  const [headPose, setHeadPose] = useState<HeadPose | null>(null);
  const [emission, setEmission] = useState<{ signal: GestureSignal; id: number } | null>(
    null,
  );

  const onSignalRef = useRef(onSignal);
  const pausedRef = useRef(paused);
  useLayoutEffect(() => {
    onSignalRef.current = onSignal;
    pausedRef.current = paused;
  }, [onSignal, paused]);

  const clearLastSignal = useCallback(() => setEmission(null), []);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let frameId = 0;
    let gestureRecognizer: GestureRecognizer | null = null;
    let faceLandmarker: FaceLandmarker | null = null;

    let lastVideoTime = -1;
    let heldGesture: string | null = null;
    let heldFrames = 0;
    let lastSignalAt = 0;
    const poseWindow: PoseSample[] = [];

    function emit(signal: GestureSignal, now: number) {
      if (pausedRef.current) return;
      if (now - lastSignalAt < SIGNAL_COOLDOWN_MS) return;
      lastSignalAt = now;
      poseWindow.length = 0;
      heldGesture = null;
      heldFrames = 0;
      setEmission((previous) => ({ signal, id: (previous?.id ?? 0) + 1 }));
      onSignalRef.current(signal);
    }

    async function boot() {
      setStatus("loading");
      setError(null);
      setIsTracking(false);
      setRawGesture(null);
      setHeadPose(null);
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (disposed) return;

        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE_PATH);
        if (disposed) return;

        [gestureRecognizer, faceLandmarker] = await Promise.all([
          vision.GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.55,
            minHandPresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          }),
          vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: "GPU" },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFacialTransformationMatrixes: true,
            outputFaceBlendshapes: false,
          }),
        ]);
        if (disposed) {
          gestureRecognizer?.close();
          faceLandmarker?.close();
          return;
        }

        setStatus("ready");
        frameId = requestAnimationFrame(detect);
      } catch (bootError) {
        if (disposed) return;
        setStatus("error");
        setError(
          bootError instanceof Error
            ? `Gesture engine failed to load: ${bootError.message}`
            : "Gesture engine failed to load.",
        );
      }
    }

    function detect() {
      frameId = requestAnimationFrame(detect);
      const video = videoRef.current;
      if (!video || !gestureRecognizer || !faceLandmarker) return;

      // The video element can exist before the stream actually has a decoded
      // frame ready (readyState < HAVE_CURRENT_DATA) or between tracks while
      // switching cameras (videoWidth briefly 0) — MediaPipe throws on either,
      // so skip the frame entirely rather than feeding it a blank/stale frame.
      const videoReady = video.readyState >= 2 && video.videoWidth > 0;
      if (!videoReady || video.paused || video.ended) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      const now = Math.floor(performance.now());
      let sawSomething = false;

      // --- Hands: thumbs up / thumbs down ---
      try {
        const handResult = gestureRecognizer.recognizeForVideo(video, now);
        const top = handResult?.gestures[0]?.[0];

        if (top && top.score >= GESTURE_MIN_SCORE) {
          sawSomething = true;
          const name = top.categoryName;
          if (name === heldGesture) {
            heldFrames += 1;
          } else {
            heldGesture = name;
            heldFrames = 1;
          }
          setRawGesture(name);

          if (heldFrames === GESTURE_HOLD_FRAMES) {
            if (name === "Thumb_Up") emit("understood", now);
            else if (name === "Thumb_Down") emit("not_understood", now);
          }
        } else {
          heldGesture = null;
          heldFrames = 0;
          setRawGesture(null);
        }
      } catch {
        // A dropped frame mid-resize throws; the next frame recovers.
      }

      // --- Face: nod (agreement) vs. shake (confusion) --------------------
      try {
        const faceResult = faceLandmarker.detectForVideo(video, now);
        const matrix = faceResult.facialTransformationMatrixes[0];
        if (matrix) {
          const pose = matrixToHeadPose(matrix.data);
          if (pose) {
            sawSomething = true;
            setHeadPose(pose);
            poseWindow.push({ t: now, yaw: pose.yaw, pitch: pose.pitch });
            while (poseWindow.length > 0 && now - poseWindow[0].t > POSE_WINDOW_MS) {
              poseWindow.shift();
            }

            if (poseWindow.length >= POSE_MIN_SAMPLES) {
              const yawStats = measureOscillation(poseWindow.map((s) => s.yaw));
              const pitchStats = measureOscillation(poseWindow.map((s) => s.pitch));

              const isShake =
                yawStats.amplitude >= SHAKE_MIN_AMPLITUDE_DEG &&
                yawStats.reversals >= MIN_REVERSALS &&
                yawStats.amplitude > pitchStats.amplitude * AXIS_DOMINANCE;
              const isNod =
                pitchStats.amplitude >= NOD_MIN_AMPLITUDE_DEG &&
                pitchStats.reversals >= MIN_REVERSALS &&
                pitchStats.amplitude > yawStats.amplitude * AXIS_DOMINANCE;

              if (isShake) emit("confused", now);
              else if (isNod) emit("agreement", now);
            }
          }
        } else {
          setHeadPose(null);
          poseWindow.length = 0;
        }
      } catch {
        // Same as above — tolerate a bad frame rather than tearing down.
      }

      setIsTracking(sawSomething);
    }

    void boot();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      try {
        gestureRecognizer?.close();
      } catch {
        // Already closed.
      }
      try {
        faceLandmarker?.close();
      } catch {
        // Already closed.
      }
      gestureRecognizer = null;
      faceLandmarker = null;
    };
  }, [enabled, videoRef]);

  // While the call is off nothing is running, so report the idle shape rather
  // than the stale values left over from the previous session.
  if (!enabled) {
    return {
      status: "idle",
      error: null,
      isTracking: false,
      rawGesture: null,
      headPose: null,
      lastSignal: null,
      lastSignalId: 0,
      clearLastSignal,
    };
  }

  return {
    status,
    error,
    isTracking,
    rawGesture,
    headPose,
    lastSignal: emission?.signal ?? null,
    lastSignalId: emission?.id ?? 0,
    clearLastSignal,
  };
}
