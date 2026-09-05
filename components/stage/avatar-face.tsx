"use client";

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { MouthFrame } from "@/lib/audio-engine";
import { resolveAvatarTheme, type AvatarTheme } from "@/lib/avatar-theme";
import type { TeacherPersona, VoiceGender } from "@/lib/types";

export type AvatarState = "idle" | "listening" | "talking";

export type AvatarVariant = "full" | "pip";

// Face landmarks in the SVG's own coordinate space. Every geometry helper
// below reads from this so the proportions stay consistent between the full
// stage portrait and the picture-in-picture crop.
const FACE = {
  centerX: 150,
  eyeY: 130,
  leftEyeX: 122,
  rightEyeX: 178,
  eyeHalfWidth: 21,
  eyeHalfHeight: 11,
  mouthY: 187,
  mouthHalfWidth: 27,
  pivotY: 232,
} as const;

const VIEWBOX: Record<AvatarVariant, string> = {
  full: "0 0 300 340",
  pip: "56 44 188 188",
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The mouth aperture. `level` is the live audio amplitude (0 closed, 1 fully
 * open), `roundness` biases between a wide vowel and a pursed one, and `smile`
 * lifts the corners so a silent avatar rests on a closed smile rather than a
 * flat line.
 */
function mouthAperturePath(level: number, roundness: number, smile: number): string {
  const cx = FACE.centerX;
  const cy = FACE.mouthY;
  const halfWidth = FACE.mouthHalfWidth * (1 - 0.28 * roundness);
  const cornerLift = 6.5 * smile;
  const upperRise = 1.4 + 6.5 * level;
  const lowerDrop = 1.6 + 25 * level * (0.72 + 0.28 * roundness);

  const left = round(cx - halfWidth);
  const right = round(cx + halfWidth);
  const cornerY = round(cy - cornerLift);

  return [
    `M ${left} ${cornerY}`,
    `Q ${cx} ${round(cy - upperRise - cornerLift * 0.6)} ${right} ${cornerY}`,
    `Q ${cx} ${round(cy + lowerDrop)} ${left} ${cornerY}`,
    "Z",
  ].join(" ");
}

/** The lip body drawn around the aperture, so the mouth has thickness. */
function lipOutlinePath(level: number, roundness: number, smile: number): string {
  const cx = FACE.centerX;
  const cy = FACE.mouthY;
  const halfWidth = FACE.mouthHalfWidth * (1 - 0.28 * roundness) + 3.4;
  const cornerLift = 6.5 * smile;
  const upperRise = 4.6 + 7 * level;
  const lowerDrop = 5.4 + 26 * level * (0.72 + 0.28 * roundness);

  const left = round(cx - halfWidth);
  const right = round(cx + halfWidth);
  const cornerY = round(cy - cornerLift);

  return [
    `M ${left} ${cornerY}`,
    `C ${round(cx - halfWidth * 0.5)} ${round(cy - upperRise - cornerLift)} ${round(cx + halfWidth * 0.5)} ${round(cy - upperRise - cornerLift)} ${right} ${cornerY}`,
    `C ${round(cx + halfWidth * 0.55)} ${round(cy + lowerDrop)} ${round(cx - halfWidth * 0.55)} ${round(cy + lowerDrop)} ${left} ${cornerY}`,
    "Z",
  ].join(" ");
}

function eyelidPath(eyeX: number): string {
  const top = FACE.eyeY - 32;
  const bottom = FACE.eyeY - FACE.eyeHalfHeight - 3;
  return [
    `M ${eyeX - 24} ${top}`,
    `L ${eyeX + 24} ${top}`,
    `L ${eyeX + 24} ${bottom}`,
    `Q ${eyeX} ${bottom + 8} ${eyeX - 24} ${bottom}`,
    "Z",
  ].join(" ");
}

function eyeAlmondPath(eyeX: number): string {
  const { eyeY, eyeHalfWidth: hw, eyeHalfHeight: hh } = FACE;
  return [
    `M ${eyeX - hw} ${eyeY}`,
    `Q ${eyeX - hw * 0.4} ${eyeY - hh * 1.55} ${eyeX} ${eyeY - hh}`,
    `Q ${eyeX + hw * 0.55} ${eyeY - hh * 0.92} ${eyeX + hw} ${eyeY}`,
    `Q ${eyeX + hw * 0.5} ${eyeY + hh * 1.15} ${eyeX} ${eyeY + hh * 0.92}`,
    `Q ${eyeX - hw * 0.5} ${eyeY + hh * 1.05} ${eyeX - hw} ${eyeY}`,
    "Z",
  ].join(" ");
}

function browPath(eyeX: number, mirrored: boolean): string {
  const direction = mirrored ? -1 : 1;
  const inner = eyeX - direction * 22;
  const outer = eyeX + direction * 21;
  const y = FACE.eyeY - 27;
  return [
    `M ${inner} ${y + 3.5}`,
    `Q ${eyeX - direction * 4} ${y - 7} ${outer} ${y - 1}`,
    `Q ${eyeX - direction * 3} ${y - 2.5} ${inner} ${y + 7}`,
    "Z",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Persona-specific hair + facial hair
// ---------------------------------------------------------------------------

function hairPath(theme: AvatarTheme): string {
  switch (theme.hairStyle) {
    case "swept":
      return "M 86 122 C 80 66 112 40 152 40 C 194 40 216 68 214 118 C 210 96 202 86 190 80 C 168 92 132 96 108 84 C 96 92 90 104 86 122 Z";
    case "silver":
      return "M 88 124 C 84 70 114 44 150 44 C 188 44 216 70 212 124 C 206 100 196 88 178 82 C 158 76 134 78 116 88 C 100 96 92 108 88 124 Z";
    case "messy":
      return "M 86 126 C 78 68 116 38 152 42 C 176 44 186 34 196 44 C 214 62 218 92 212 126 C 206 102 200 92 188 84 C 176 98 158 84 144 92 C 130 100 116 86 106 96 C 96 104 90 112 86 126 Z";
    case "long":
      return "M 84 132 C 78 70 112 42 150 42 C 190 42 220 70 216 132 C 224 168 222 200 216 226 C 210 198 208 170 206 146 C 200 112 182 92 150 92 C 118 92 100 112 94 146 C 92 170 90 198 84 226 C 78 200 76 168 84 132 Z";
    case "neat":
    default:
      return "M 88 124 C 84 68 114 42 150 42 C 186 42 216 68 212 124 C 204 98 192 86 172 80 C 152 74 128 78 112 88 C 100 96 92 108 88 124 Z";
  }
}

function FacialHairLayer({ theme }: { theme: AvatarTheme }) {
  if (theme.facialHair === "none") return null;

  if (theme.facialHair === "grey-beard") {
    return (
      <>
        <path
          d="M 100 150 C 100 190 118 218 150 218 C 182 218 200 190 200 150 C 198 178 186 196 168 202 C 168 190 160 184 150 184 C 140 184 132 190 132 202 C 114 196 102 178 100 150 Z"
          fill={theme.hair}
          opacity={0.55}
        />
        <path
          d="M 128 172 Q 150 166 172 172 Q 150 180 128 172 Z"
          fill={theme.hair}
          opacity={0.6}
        />
      </>
    );
  }

  return (
    <path
      d="M 104 152 C 106 188 122 214 150 214 C 178 214 194 188 196 152 C 192 180 178 198 150 198 C 122 198 108 180 104 152 Z"
      fill={theme.hair}
      opacity={0.16}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface AvatarFaceProps {
  persona: TeacherPersona;
  voiceGender: VoiceGender;
  state: AvatarState;
  /** Stable getter polled every frame; supplied by useNarrator(). */
  readMouthFrame: () => MouthFrame;
  variant?: AvatarVariant;
  className?: string;
}

/**
 * An expressive, fully vector educator face. The mouth is driven frame by
 * frame from the live audio analyser rather than from a timer, so the lips
 * actually track the syllables the neural voice is producing; blinks,
 * saccades, brow motion and head sway run on their own idle rhythms so the
 * face stays alive between utterances.
 *
 * All per-frame work writes straight to SVG attributes through refs — putting
 * mouth openness in React state would re-render the whole tree sixty times a
 * second for no benefit.
 */
export function AvatarFace({
  persona,
  voiceGender,
  state,
  readMouthFrame,
  variant = "full",
  className,
}: AvatarFaceProps) {
  const theme = resolveAvatarTheme(persona, voiceGender);
  const uid = useId().replace(/:/g, "");

  const headRef = useRef<SVGGElement | null>(null);
  const browsRef = useRef<SVGGElement | null>(null);
  const leftLidRef = useRef<SVGGElement | null>(null);
  const rightLidRef = useRef<SVGGElement | null>(null);
  const leftIrisRef = useRef<SVGGElement | null>(null);
  const rightIrisRef = useRef<SVGGElement | null>(null);
  const apertureRef = useRef<SVGPathElement | null>(null);
  const apertureClipRef = useRef<SVGPathElement | null>(null);
  const lipsRef = useRef<SVGPathElement | null>(null);
  const teethRef = useRef<SVGRectElement | null>(null);
  const tongueRef = useRef<SVGEllipseElement | null>(null);

  // The animation loop reads the latest props without being torn down and
  // rebuilt on every state change. Synced in a layout effect so nothing is
  // written to a ref during render.
  const stateRef = useRef(state);
  const readMouthFrameRef = useRef(readMouthFrame);
  useLayoutEffect(() => {
    stateRef.current = state;
    readMouthFrameRef.current = readMouthFrame;
  }, [state, readMouthFrame]);

  useEffect(() => {
    let frameId = 0;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reduceMotion ? 0.25 : 1;

    let blinkPhase = 0;
    let nextBlinkAt = 900;
    let gazeX = 0;
    let gazeY = 0;
    let gazeTargetX = 0;
    let gazeTargetY = 0;
    let nextGazeAt = 1400;
    let smile = 0.55;
    let browLift = 0;
    const start = performance.now();

    function tick(now: number) {
      frameId = requestAnimationFrame(tick);
      const elapsed = now - start;
      const seconds = elapsed / 1000;
      const currentState = stateRef.current;
      const { level, roundness } = readMouthFrameRef.current();

      // --- blink -----------------------------------------------------------
      if (elapsed > nextBlinkAt) {
        blinkPhase = 1;
        // Humans blink every 2-6 seconds, and more often while listening.
        nextBlinkAt = elapsed + (currentState === "listening" ? 1800 : 2600) + Math.random() * 3200;
      }
      if (blinkPhase > 0) {
        blinkPhase -= 0.16;
        if (blinkPhase < 0) blinkPhase = 0;
      }
      // A single triangular pulse: shut fast, open slightly slower.
      const lidClose = blinkPhase > 0 ? Math.sin(Math.PI * (1 - blinkPhase)) : 0;
      const lidDrop = 16.5 * lidClose + (currentState === "listening" ? -1.2 : 0);
      leftLidRef.current?.setAttribute("transform", `translate(0 ${round(lidDrop)})`);
      rightLidRef.current?.setAttribute("transform", `translate(0 ${round(lidDrop)})`);

      // --- gaze ------------------------------------------------------------
      if (elapsed > nextGazeAt) {
        // Look at the student most of the time; glance away occasionally, the
        // way a teacher does when reaching for the next idea.
        const glanceAway = Math.random() < (currentState === "talking" ? 0.45 : 0.3);
        gazeTargetX = glanceAway ? (Math.random() - 0.5) * 5.6 : 0;
        gazeTargetY = glanceAway ? (Math.random() - 0.5) * 3.2 : 0;
        nextGazeAt = elapsed + 1200 + Math.random() * 2600;
      }
      gazeX += (gazeTargetX * motion - gazeX) * 0.08;
      gazeY += (gazeTargetY * motion - gazeY) * 0.08;
      const gazeTransform = `translate(${round(gazeX)} ${round(gazeY)})`;
      leftIrisRef.current?.setAttribute("transform", gazeTransform);
      rightIrisRef.current?.setAttribute("transform", gazeTransform);

      // --- head ------------------------------------------------------------
      const swayAmount = currentState === "talking" ? 1 : 0.55;
      const dx = Math.sin(seconds * 0.62) * 2.4 * swayAmount * motion;
      const dy =
        (Math.sin(seconds * 0.85) * 1.5 + (currentState === "talking" ? level * 1.6 : 0)) *
        swayAmount *
        motion;
      // Listening reads as an attentive tilt toward the student.
      const tiltTarget = currentState === "listening" ? 3.6 : 0;
      const rotation =
        (Math.sin(seconds * 0.44) * 1.5 * swayAmount + tiltTarget) * motion;
      headRef.current?.setAttribute(
        "transform",
        `translate(${round(dx)} ${round(dy)}) rotate(${round(rotation)} ${FACE.centerX} ${FACE.pivotY})`,
      );

      // --- brows -----------------------------------------------------------
      const browTarget =
        currentState === "listening" ? -3.2 : currentState === "talking" ? -level * 2.6 : 0;
      browLift += (browTarget * motion - browLift) * 0.12;
      browsRef.current?.setAttribute("transform", `translate(0 ${round(browLift)})`);

      // --- mouth -----------------------------------------------------------
      // Smiling relaxes as the mouth opens: you cannot hold a wide grin and
      // articulate an "oh" at the same time.
      const smileTarget =
        currentState === "talking" ? 0.32 - level * 0.22 : currentState === "listening" ? 0.72 : 0.6;
      smile += (smileTarget - smile) * 0.09;

      const aperture = mouthAperturePath(level, roundness, smile);
      apertureRef.current?.setAttribute("d", aperture);
      apertureClipRef.current?.setAttribute("d", aperture);
      lipsRef.current?.setAttribute("d", lipOutlinePath(level, roundness, smile));

      const teeth = teethRef.current;
      if (teeth) {
        const teethOpacity = level > 0.12 ? Math.min(1, (level - 0.12) * 4.5) : 0;
        teeth.setAttribute("opacity", round(teethOpacity).toString());
      }
      const tongue = tongueRef.current;
      if (tongue) {
        const tongueOpacity = level > 0.45 ? Math.min(0.9, (level - 0.45) * 2.6) : 0;
        tongue.setAttribute("opacity", round(tongueOpacity).toString());
        tongue.setAttribute("cy", round(FACE.mouthY + 8 + level * 12).toString());
      }
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const restingAperture = mouthAperturePath(0, 0.3, 0.6);
  const restingLips = lipOutlinePath(0, 0.3, 0.6);

  return (
    <svg
      viewBox={VIEWBOX[variant]}
      className={className}
      role="img"
      aria-label={`${theme.title} avatar, currently ${state}`}
    >
      <defs>
        <radialGradient id={`${uid}-backdrop`} cx="50%" cy="42%" r="72%">
          <stop offset="0%" stopColor={theme.backdropInner} />
          <stop offset="100%" stopColor={theme.backdropOuter} />
        </radialGradient>
        <radialGradient id={`${uid}-skin`} cx="42%" cy="34%" r="70%">
          <stop offset="0%" stopColor={theme.skinLight} />
          <stop offset="62%" stopColor={theme.skinBase} />
          <stop offset="100%" stopColor={theme.skinShadow} />
        </radialGradient>
        <radialGradient id={`${uid}-iris`} cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor={theme.irisLight} />
          <stop offset="70%" stopColor={theme.irisDark} />
          <stop offset="100%" stopColor={theme.limbalRing} />
        </radialGradient>
        <linearGradient id={`${uid}-jacket`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={theme.jacket} />
          <stop offset="100%" stopColor={theme.backdropOuter} />
        </linearGradient>
        <radialGradient id={`${uid}-blush`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={theme.blush} stopOpacity="0.5" />
          <stop offset="100%" stopColor={theme.blush} stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${uid}-left-eye`}>
          <path d={eyeAlmondPath(FACE.leftEyeX)} />
        </clipPath>
        <clipPath id={`${uid}-right-eye`}>
          <path d={eyeAlmondPath(FACE.rightEyeX)} />
        </clipPath>
        <clipPath id={`${uid}-mouth`}>
          <path ref={apertureClipRef} d={restingAperture} />
        </clipPath>
      </defs>

      <rect x="0" y="0" width="300" height="340" fill={`url(#${uid}-backdrop)`} />

      {/* Bust: shoulders, collar and jacket sit behind the head group so head
          sway reads as motion relative to a still body. */}
      <g>
        <path
          d="M 18 340 C 24 288 62 258 108 246 L 192 246 C 238 258 276 288 282 340 Z"
          fill={`url(#${uid}-jacket)`}
        />
        <path d="M 124 244 L 150 292 L 176 244 L 164 240 L 150 262 L 136 240 Z" fill={theme.collar} />
        <path d="M 128 214 L 172 214 L 172 250 L 128 250 Z" fill={theme.skinShadow} />
        <path d="M 128 214 L 172 214 L 172 232 Q 150 244 128 232 Z" fill={theme.skinBase} opacity="0.85" />
      </g>

      <g ref={headRef}>
        <ellipse cx="86" cy="140" rx="9" ry="16" fill={`url(#${uid}-skin)`} />
        <ellipse cx="214" cy="140" rx="9" ry="16" fill={`url(#${uid}-skin)`} />

        <path
          d="M 88 118 C 88 70 112 46 150 46 C 188 46 212 70 212 118 C 212 150 206 174 190 192 C 178 206 164 216 150 216 C 136 216 122 206 110 192 C 94 174 88 150 88 118 Z"
          fill={`url(#${uid}-skin)`}
        />

        <ellipse cx="108" cy="166" rx="17" ry="11" fill={`url(#${uid}-blush)`} />
        <ellipse cx="192" cy="166" rx="17" ry="11" fill={`url(#${uid}-blush)`} />

        <FacialHairLayer theme={theme} />

        {/* Nose */}
        <path
          d={`M ${FACE.centerX} 132 L ${FACE.centerX - 6} 162 Q ${FACE.centerX} 168 ${FACE.centerX + 6} 162`}
          fill="none"
          stroke={theme.skinShadow}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.75"
        />
        <ellipse cx={FACE.centerX - 8.5} cy="163" rx="3.4" ry="2.2" fill={theme.skinShadow} opacity="0.5" />
        <ellipse cx={FACE.centerX + 8.5} cy="163" rx="3.4" ry="2.2" fill={theme.skinShadow} opacity="0.5" />

        {/* Eyes */}
        {(
          [
            { x: FACE.leftEyeX, clip: `${uid}-left-eye`, irisRef: leftIrisRef, lidRef: leftLidRef },
            { x: FACE.rightEyeX, clip: `${uid}-right-eye`, irisRef: rightIrisRef, lidRef: rightLidRef },
          ] as const
        ).map((eye) => (
          <g key={eye.clip}>
            <g clipPath={`url(#${eye.clip})`}>
              <path d={eyeAlmondPath(eye.x)} fill="#f8fafc" />
              <g ref={eye.irisRef}>
                <circle cx={eye.x} cy={FACE.eyeY} r="9" fill={`url(#${uid}-iris)`} />
                <circle
                  cx={eye.x}
                  cy={FACE.eyeY}
                  r="9"
                  fill="none"
                  stroke={theme.limbalRing}
                  strokeWidth="1.4"
                />
                <circle cx={eye.x} cy={FACE.eyeY} r="3.9" fill="#0b1220" />
                <circle cx={eye.x - 3} cy={FACE.eyeY - 3.2} r="2.5" fill="#ffffff" opacity="0.92" />
                <circle cx={eye.x + 3.4} cy={FACE.eyeY + 2.8} r="1.1" fill="#ffffff" opacity="0.5" />
              </g>
              {/* Contact shadow cast by the upper lid onto the eyeball. */}
              <path
                d={`M ${eye.x - 22} ${FACE.eyeY - 14} Q ${eye.x} ${FACE.eyeY - 4} ${eye.x + 22} ${FACE.eyeY - 14} L ${eye.x + 22} ${FACE.eyeY - 24} L ${eye.x - 22} ${FACE.eyeY - 24} Z`}
                fill="#0b1220"
                opacity="0.16"
              />
            </g>
            <path
              d={eyeAlmondPath(eye.x)}
              fill="none"
              stroke={theme.skinShadow}
              strokeWidth="1.6"
              opacity="0.6"
            />
            <g ref={eye.lidRef}>
              <path d={eyelidPath(eye.x)} fill={`url(#${uid}-skin)`} />
              <path
                d={`M ${eye.x - 24} ${FACE.eyeY - FACE.eyeHalfHeight - 3} Q ${eye.x} ${FACE.eyeY - FACE.eyeHalfHeight + 5} ${eye.x + 24} ${FACE.eyeY - FACE.eyeHalfHeight - 3}`}
                fill="none"
                stroke={theme.brow}
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.55"
              />
            </g>
          </g>
        ))}

        {/* Brows */}
        <g ref={browsRef}>
          <path d={browPath(FACE.leftEyeX, false)} fill={theme.brow} />
          <path d={browPath(FACE.rightEyeX, true)} fill={theme.brow} />
        </g>

        {theme.glasses && (
          <g fill="none" stroke={theme.accent} strokeWidth="2.6" opacity="0.9">
            <rect
              x={FACE.leftEyeX - 25}
              y={FACE.eyeY - 17}
              width="50"
              height="34"
              rx="12"
              fill="#e2e8f0"
              fillOpacity="0.07"
            />
            <rect
              x={FACE.rightEyeX - 25}
              y={FACE.eyeY - 17}
              width="50"
              height="34"
              rx="12"
              fill="#e2e8f0"
              fillOpacity="0.07"
            />
            <path d={`M ${FACE.leftEyeX + 25} ${FACE.eyeY} L ${FACE.rightEyeX - 25} ${FACE.eyeY}`} />
            <path d={`M ${FACE.leftEyeX - 25} ${FACE.eyeY - 4} L 90 ${FACE.eyeY - 6}`} />
            <path d={`M ${FACE.rightEyeX + 25} ${FACE.eyeY - 4} L 210 ${FACE.eyeY - 6}`} />
          </g>
        )}

        {/* Mouth: lips, then the aperture, with teeth and tongue clipped to it. */}
        <path ref={lipsRef} d={restingLips} fill={theme.lipBase} />
        <path ref={apertureRef} d={restingAperture} fill="#3d1520" />
        <g clipPath={`url(#${uid}-mouth)`}>
          <rect
            ref={teethRef}
            x={FACE.centerX - 26}
            y={FACE.mouthY - 9}
            width="52"
            height="9"
            rx="2.5"
            fill="#f8fafc"
            opacity="0"
          />
          <ellipse
            ref={tongueRef}
            cx={FACE.centerX}
            cy={FACE.mouthY + 8}
            rx="15"
            ry="9"
            fill="#b4506a"
            opacity="0"
          />
        </g>
        <path
          d={`M ${FACE.centerX - 30} ${FACE.mouthY - 1} Q ${FACE.centerX} ${FACE.mouthY - 6} ${FACE.centerX + 30} ${FACE.mouthY - 1}`}
          fill="none"
          stroke={theme.lipShadow}
          strokeWidth="1.2"
          opacity="0.35"
        />

        <path d={hairPath(theme)} fill={theme.hair} />
        <path
          d={hairPath(theme)}
          fill={theme.hairHighlight}
          opacity="0.35"
          transform="translate(-4 -4) scale(0.98) translate(3 3)"
        />
      </g>
    </svg>
  );
}
