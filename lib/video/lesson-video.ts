import {
  PERSONA_COLORS,
  type ConceptNode,
  type DiagramData,
  type LessonPayload,
  type TeacherPersona,
} from "@/lib/types";

/**
 * The teaching-video engine.
 *
 * This renders an actual lesson video: an animated presenter lip-synced to
 * the same neural voice the live tutor speaks with, the turn's diagram or
 * code on screen beside her, captions cut to the narration, and the concept
 * plan as a syllabus card — then records the whole thing to a file the
 * student can keep.
 *
 * It is drawn to a canvas rather than assembled from DOM. That is what makes
 * the export real: a canvas exposes captureStream(), so the frames the
 * student watched are literally the frames written to the file, and the
 * narration is piped into the same MediaRecorder as a second track. There is
 * no separate "render path" that could drift from the preview, and no
 * headless browser needed to produce the download.
 *
 * Everything here is defensive. A browser without MediaRecorder still gets
 * the preview; a failed TTS call still gets a silent video with captions;
 * a malformed diagram still gets a frame rather than an exception.
 */

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export const FPS = 30;
export const WIDTH = 1280;
export const HEIGHT = 720;

/** Title card holds before the narration begins, so it isn't dead air. */
const TITLE_SECONDS = 2.2;
/** Outro card after the narration ends. */
const OUTRO_SECONDS = 2.4;
/** Used when there is no audio to measure — roughly natural reading pace. */
const FALLBACK_WORDS_PER_SECOND = 2.6;

// ---------------------------------------------------------------------------
// Script → captions
// ---------------------------------------------------------------------------

export interface Caption {
  text: string;
  start: number;
  end: number;
}

/**
 * Splits on sentence enders across the scripts we actually teach in — the
 * Latin full stop, the Devanagari danda, and the CJK ideographic stop — so a
 * Hindi or Japanese lesson gets real captions rather than one unbroken block.
 */
export function splitSentences(script: string): string[] {
  const parts = script
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?।॥。？！])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [script.trim()].filter(Boolean);
}

/**
 * Distributes the narration's real duration across sentences by length.
 *
 * Proportional-by-character is not perfect timing, but it is stable and it
 * never drifts: the last caption always ends exactly when the audio does,
 * which is the error a viewer actually notices.
 */
export function buildCaptions(script: string, narrationSeconds: number, offset: number): Caption[] {
  const sentences = splitSentences(script);
  const totalChars = sentences.reduce((sum, sentence) => sum + sentence.length, 0) || 1;

  let cursor = offset;
  return sentences.map((text) => {
    const share = (text.length / totalChars) * narrationSeconds;
    const caption = { text, start: cursor, end: cursor + share };
    cursor += share;
    return caption;
  });
}

export function estimateNarrationSeconds(script: string): number {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, words / FALLBACK_WORDS_PER_SECOND);
}

// ---------------------------------------------------------------------------
// Storyboard
// ---------------------------------------------------------------------------

export type StagePanelKind = "concepts" | "code" | "diagram";

export interface Storyboard {
  title: string;
  subtitle: string;
  conceptPlan: ConceptNode[];
  panel: StagePanelKind;
  code?: { lines: string[]; highlight: number[] };
  diagram?: DiagramData;
  caption: string;
  captions: Caption[];
  persona: TeacherPersona;
  languageLabel: string;
  levelLabel: string;
  narrationStart: number;
  narrationEnd: number;
  duration: number;
  nextConcept?: string;
}

function currentConceptLabel(plan: ConceptNode[]): string | undefined {
  return (plan.find((c) => c.status === "current") ?? plan[0])?.label;
}

export function buildStoryboard(
  lesson: LessonPayload,
  options: {
    persona: TeacherPersona;
    languageLabel: string;
    levelLabel: string;
    narrationSeconds: number;
  },
): Storyboard {
  const director = lesson.visual_director;

  let panel: StagePanelKind = "concepts";
  if (director.mode === "code" && director.code_snippet) panel = "code";
  else if (
    (director.mode === "diagram" || director.mode === "concept_flow") &&
    director.diagram_data &&
    director.diagram_data.nodes.length > 0
  ) {
    panel = "diagram";
  }

  const narrationStart = TITLE_SECONDS;
  const narrationEnd = narrationStart + options.narrationSeconds;

  const nextIndex = lesson.concept_plan.findIndex((c) => c.status === "current");
  const nextConcept =
    nextIndex >= 0 ? lesson.concept_plan[nextIndex + 1]?.label : lesson.concept_plan[0]?.label;

  return {
    title: currentConceptLabel(lesson.concept_plan) ?? "Your lesson",
    subtitle: lesson.teaching_phase.replace(/^\w/, (c) => c.toUpperCase()),
    conceptPlan: lesson.concept_plan,
    panel,
    code:
      panel === "code"
        ? {
            lines: (director.code_snippet ?? "").split("\n").slice(0, 16),
            highlight: director.highlight_lines ?? [],
          }
        : undefined,
    diagram: panel === "diagram" ? director.diagram_data : undefined,
    caption: director.caption,
    captions: buildCaptions(lesson.avatar_script, options.narrationSeconds, narrationStart),
    persona: options.persona,
    languageLabel: options.languageLabel,
    levelLabel: options.levelLabel,
    narrationStart,
    narrationEnd,
    duration: narrationEnd + OUTRO_SECONDS,
    nextConcept,
  };
}

// ---------------------------------------------------------------------------
// Narration: fetch, decode, and reduce to a mouth-opening envelope
// ---------------------------------------------------------------------------

export interface Narration {
  buffer: AudioBuffer;
  /** Mouth openness 0..1, one entry per video frame. */
  envelope: Float32Array;
  seconds: number;
}

/**
 * Precomputing the envelope, rather than reading a live analyser, is what
 * makes the exported file match the preview frame for frame — the recorder
 * runs in real time, but the mouth for frame N is a pure function of N either
 * way.
 */
export function buildEnvelope(buffer: AudioBuffer): Float32Array {
  const channel = buffer.getChannelData(0);
  const frames = Math.max(1, Math.ceil(buffer.duration * FPS));
  const samplesPerFrame = Math.max(1, Math.floor(channel.length / frames));
  const envelope = new Float32Array(frames);

  let peak = 0.0001;
  for (let frame = 0; frame < frames; frame += 1) {
    const start = frame * samplesPerFrame;
    const end = Math.min(channel.length, start + samplesPerFrame);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += channel[i] * channel[i];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    envelope[frame] = rms;
    if (rms > peak) peak = rms;
  }

  // Normalise against this clip's own peak, then soften: a jaw opens fast and
  // closes slowly, and raw RMS makes the mouth flicker shut between syllables.
  let previous = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const target = Math.min(1, (envelope[frame] / peak) * 1.35);
    previous = target > previous ? target : previous * 0.72 + target * 0.28;
    envelope[frame] = previous;
  }

  return envelope;
}

export async function loadNarration(
  audioContext: AudioContext,
  bytes: ArrayBuffer,
): Promise<Narration> {
  const buffer = await audioContext.decodeAudioData(bytes.slice(0));
  return { buffer, envelope: buildEnvelope(buffer), seconds: buffer.duration };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

const INK = "#e2e8f0";
const MUTED = "#94a3b8";
const FAINT = "#64748b";
const ACCENT = "#818cf8";
const SURFACE = "rgba(255,255,255,0.045)";
const STROKE = "rgba(255,255,255,0.10)";

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) return lines;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function background(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, "#0b1020");
  gradient.addColorStop(0.55, "#0f172a");
  gradient.addColorStop(1, "#0a0f1c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // A soft accent bloom behind the presenter, so the frame has a light source.
  const glow = ctx.createRadialGradient(250, 560, 20, 250, 560, 420);
  glow.addColorStop(0, "rgba(99,102,241,0.18)");
  glow.addColorStop(1, "rgba(99,102,241,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 200, 700, 520);
}

function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): number {
  ctx.font = "600 15px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const width = ctx.measureText(text).width + 26;
  ctx.fillStyle = SURFACE;
  roundRect(ctx, x, y, width, 30, 15);
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = MUTED;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 13, y + 16);
  return width;
}

/**
 * The presenter. Drawn rather than filmed, and drawn from the same persona
 * palette the live avatar uses, so the video and the tutor are recognisably
 * the same teacher.
 */
function drawPresenter(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  persona: TeacherPersona,
  mouthOpen: number,
  time: number,
) {
  const colors = PERSONA_COLORS[persona] ?? PERSONA_COLORS.standard;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Plinth
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.ellipse(0, 172, 132, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  // Shoulders
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.moveTo(-118, 175);
  ctx.quadraticCurveTo(-96, 78, 0, 66);
  ctx.quadraticCurveTo(96, 78, 118, 175);
  ctx.closePath();
  ctx.fill();

  // Collar
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(-26, 70);
  ctx.lineTo(0, 116);
  ctx.lineTo(26, 70);
  ctx.closePath();
  ctx.fill();

  // Neck
  ctx.fillStyle = colors.head;
  roundRect(ctx, -19, 24, 38, 52, 14);
  ctx.fill();

  // Head — a slight breathing bob keeps the frame alive between syllables.
  const bob = Math.sin(time * 1.6) * 2.2;
  ctx.save();
  ctx.translate(0, bob);

  ctx.fillStyle = colors.head;
  ctx.beginPath();
  ctx.ellipse(0, -22, 66, 76, 0, 0, Math.PI * 2);
  ctx.fill();

  // Hair
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.ellipse(0, -68, 68, 44, 0, Math.PI, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -48, 68, 52, 0, Math.PI * 1.03, Math.PI * 1.97);
  ctx.fill();

  // Blink: humans blink every few seconds, and the pattern is what sells it.
  const blinkCycle = time % 4.1;
  const lid = blinkCycle < 0.16 ? Math.sin((blinkCycle / 0.16) * Math.PI) : 0;

  for (const side of [-1, 1]) {
    const ex = side * 25;
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.ellipse(ex, -26, 15, 11 * (1 - lid) + 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.ellipse(ex, -26, 6.4 * (1 - lid * 0.85), 6.6 * (1 - lid), 0, 0, Math.PI * 2);
    ctx.fill();

    // Glasses, matching the live avatar
    ctx.strokeStyle = "rgba(148,163,184,0.85)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.ellipse(ex, -26, 22, 18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(148,163,184,0.85)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(-3, -26);
  ctx.lineTo(3, -26);
  ctx.stroke();

  // Brows lift a little with the voice — carries most of the "alive" feeling.
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    const ex = side * 25;
    ctx.beginPath();
    ctx.moveTo(ex - 15, -48 - mouthOpen * 3);
    ctx.quadraticCurveTo(ex, -55 - mouthOpen * 4, ex + 15, -48 - mouthOpen * 3);
    ctx.stroke();
  }

  // Mouth
  const openness = Math.min(1, Math.max(0, mouthOpen));
  const mouthHeight = 3 + openness * 21;
  const mouthWidth = 20 + openness * 9;
  ctx.fillStyle = "#7f1d1d";
  ctx.beginPath();
  ctx.ellipse(0, 20, mouthWidth, mouthHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  if (openness > 0.28) {
    ctx.fillStyle = "#fef2f2";
    ctx.beginPath();
    ctx.ellipse(0, 20 - mouthHeight / 2 + 3, mouthWidth * 0.76, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.restore();
}

function drawConceptPanel(
  ctx: CanvasRenderingContext2D,
  board: Storyboard,
  x: number,
  y: number,
  w: number,
  progress: number,
) {
  ctx.fillStyle = FAINT;
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("LESSON PLAN", x, y);

  const rowHeight = 58;
  board.conceptPlan.slice(0, 8).forEach((concept, i) => {
    const appear = easeOut((progress - i * 0.08) * 3);
    if (appear <= 0) return;

    const rowY = y + 22 + i * rowHeight;
    ctx.globalAlpha = appear;
    ctx.translate((1 - appear) * 18, 0);

    const active = concept.status === "current";
    const done = concept.status === "completed";
    const weak = concept.status === "misconception";

    ctx.fillStyle = active ? "rgba(99,102,241,0.16)" : SURFACE;
    roundRect(ctx, x, rowY, w, 46, 12);
    ctx.fill();
    ctx.strokeStyle = active ? "rgba(129,140,248,0.55)" : STROKE;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    const dotColor = done ? "#34d399" : weak ? "#fbbf24" : active ? ACCENT : "#475569";
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(x + 24, rowY + 23, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = active || done ? INK : MUTED;
    ctx.font = `${active ? "600" : "400"} 18px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    const label = wrapLines(ctx, concept.label, w - 64, 1)[0] ?? concept.label;
    ctx.fillText(label, x + 42, rowY + 24);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  });
}

function drawCodePanel(
  ctx: CanvasRenderingContext2D,
  board: Storyboard,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
) {
  ctx.fillStyle = "rgba(2,6,23,0.72)";
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const lines = board.code?.lines ?? [];
  const highlight = new Set(board.code?.highlight ?? []);
  const active = board.code?.highlight?.[board.code.highlight.length - 1];

  ctx.font = "15px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textBaseline = "middle";

  const lineHeight = Math.min(28, (h - 40) / Math.max(1, lines.length));
  lines.forEach((line, i) => {
    const appear = easeOut((progress - i * 0.04) * 4);
    if (appear <= 0) return;
    const rowY = y + 26 + i * lineHeight;
    const number = i + 1;

    if (highlight.has(number)) {
      ctx.fillStyle = number === active ? "rgba(129,140,248,0.22)" : "rgba(129,140,248,0.10)";
      roundRect(ctx, x + 10, rowY - lineHeight / 2 + 2, w - 20, lineHeight - 4, 6);
      ctx.fill();
    }

    ctx.globalAlpha = appear;
    ctx.textAlign = "right";
    ctx.fillStyle = number === active ? ACCENT : "#475569";
    ctx.fillText(String(number), x + 42, rowY);

    ctx.textAlign = "left";
    ctx.fillStyle = number === active ? "#e0e7ff" : "#cbd5e1";
    const text = line.length > 46 ? `${line.slice(0, 45)}…` : line;
    ctx.fillText(text, x + 56, rowY);
    ctx.globalAlpha = 1;
  });
}

function drawDiagramPanel(
  ctx: CanvasRenderingContext2D,
  board: Storyboard,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
) {
  const data = board.diagram;
  if (!data || data.nodes.length === 0) return;

  const nodes = data.nodes.slice(0, 6);
  const boxW = Math.min(250, w - 40);
  const boxH = 56;
  const gap = Math.min(46, (h - nodes.length * boxH) / Math.max(1, nodes.length + 1));
  const startY = y + Math.max(20, (h - (nodes.length * boxH + (nodes.length - 1) * gap)) / 2);
  const cx = x + w / 2;

  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, i) => {
    positions.set(node.id, { x: cx, y: startY + i * (boxH + gap) + boxH / 2 });
  });

  // Edges first, so boxes sit on top of their connectors.
  ctx.strokeStyle = "rgba(148,163,184,0.45)";
  ctx.lineWidth = 2;
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const edge of data.edges.slice(0, 10)) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const appear = easeOut(progress * 2 - 0.2);
    if (appear <= 0) continue;

    ctx.globalAlpha = appear;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y + boxH / 2);
    ctx.lineTo(to.x, to.y - boxH / 2 - 8);
    ctx.stroke();

    // Arrowhead
    ctx.beginPath();
    ctx.moveTo(to.x, to.y - boxH / 2);
    ctx.lineTo(to.x - 6, to.y - boxH / 2 - 9);
    ctx.lineTo(to.x + 6, to.y - boxH / 2 - 9);
    ctx.closePath();
    ctx.fillStyle = "rgba(148,163,184,0.65)";
    ctx.fill();

    if (edge.label) {
      const midY = (from.y + boxH / 2 + to.y - boxH / 2) / 2;
      const labelWidth = ctx.measureText(edge.label).width + 16;
      ctx.fillStyle = "#0f172a";
      roundRect(ctx, from.x - labelWidth / 2, midY - 11, labelWidth, 22, 11);
      ctx.fill();
      ctx.strokeStyle = STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(edge.label, from.x, midY);
      ctx.strokeStyle = "rgba(148,163,184,0.45)";
      ctx.lineWidth = 2;
    }
    ctx.globalAlpha = 1;
  }

  nodes.forEach((node, i) => {
    const appear = easeOut((progress - i * 0.1) * 3);
    if (appear <= 0) return;
    const position = positions.get(node.id);
    if (!position) return;

    const tone =
      node.status === "success"
        ? { fill: "rgba(16,185,129,0.16)", stroke: "rgba(52,211,153,0.65)", text: "#a7f3d0" }
        : node.status === "warning"
          ? { fill: "rgba(245,158,11,0.16)", stroke: "rgba(251,191,36,0.65)", text: "#fde68a" }
          : node.status === "active"
            ? { fill: "rgba(99,102,241,0.20)", stroke: "rgba(129,140,248,0.8)", text: "#e0e7ff" }
            : { fill: SURFACE, stroke: STROKE, text: "#cbd5e1" };

    ctx.globalAlpha = appear;
    const scale = 0.94 + appear * 0.06;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.scale(scale, scale);

    ctx.fillStyle = tone.fill;
    roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, 14);
    ctx.fill();
    ctx.strokeStyle = tone.stroke;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = tone.text;
    ctx.font = "600 16px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wrapLines(ctx, node.label, boxW - 28, 2);
    lines.forEach((line, li) => {
      ctx.fillText(line, 0, (li - (lines.length - 1) / 2) * 19);
    });

    ctx.restore();
    ctx.globalAlpha = 1;
  });
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, appear: number) {
  if (!text) return;
  ctx.font = "500 27px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const maxWidth = 900;
  const lines = wrapLines(ctx, text, maxWidth, 3);
  const lineHeight = 38;
  const boxHeight = lines.length * lineHeight + 34;
  const boxWidth = Math.min(
    maxWidth + 56,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + 56,
  );
  const x = (WIDTH - boxWidth) / 2;
  const y = HEIGHT - boxHeight - 46;

  ctx.globalAlpha = appear;
  ctx.fillStyle = "rgba(2,6,23,0.78)";
  roundRect(ctx, x, y, boxWidth, boxHeight, 16);
  ctx.fill();
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#f1f5f9";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(line, WIDTH / 2, y + 17 + lineHeight / 2 + i * lineHeight);
  });
  ctx.globalAlpha = 1;
}

function drawTitleCard(ctx: CanvasRenderingContext2D, board: Storyboard, t: number) {
  const appear = easeOut(t / 0.8);
  ctx.globalAlpha = appear;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = ACCENT;
  ctx.font = "700 16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("AI TEACHER", WIDTH / 2, HEIGHT / 2 - 118);

  ctx.fillStyle = INK;
  ctx.font = "700 54px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  const lines = wrapLines(ctx, board.title, 940, 2);
  lines.forEach((line, i) => {
    ctx.fillText(line, WIDTH / 2, HEIGHT / 2 - 42 + i * 62);
  });

  ctx.fillStyle = MUTED;
  ctx.font = "400 22px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(board.caption, WIDTH / 2, HEIGHT / 2 + 52 + (lines.length - 1) * 62);

  // Meta chips, centred as a row
  const labels = [board.languageLabel, board.levelLabel, `${board.conceptPlan.length} concepts`];
  ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
  const widths = labels.map((label) => ctx.measureText(label).width + 26);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + (labels.length - 1) * 10;
  let chipX = (WIDTH - totalWidth) / 2;
  const chipY = HEIGHT / 2 + 96 + (lines.length - 1) * 62;
  labels.forEach((label, i) => {
    chip(ctx, label, chipX, chipY);
    chipX += widths[i] + 10;
  });

  ctx.globalAlpha = 1;
}

function drawOutro(ctx: CanvasRenderingContext2D, board: Storyboard, t: number) {
  const appear = easeOut(t / 0.7);
  ctx.globalAlpha = appear;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const completed = board.conceptPlan.filter((c) => c.status === "completed").length;

  ctx.fillStyle = ACCENT;
  ctx.font = "700 16px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("END OF THIS SEGMENT", WIDTH / 2, HEIGHT / 2 - 86);

  ctx.fillStyle = INK;
  ctx.font = "700 40px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    `${completed} of ${board.conceptPlan.length} concepts mastered`,
    WIDTH / 2,
    HEIGHT / 2 - 20,
  );

  if (board.nextConcept) {
    ctx.fillStyle = MUTED;
    ctx.font = "400 24px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`Up next — ${board.nextConcept}`, WIDTH / 2, HEIGHT / 2 + 40);
  }
  ctx.globalAlpha = 1;
}

/** Draws the whole frame at time `t` seconds. Pure: same t, same pixels. */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  board: Storyboard,
  t: number,
  envelope: Float32Array | null,
) {
  background(ctx);

  if (t < board.narrationStart) {
    drawTitleCard(ctx, board, t);
    return;
  }

  if (t >= board.narrationEnd) {
    drawOutro(ctx, board, t - board.narrationEnd);
    return;
  }

  const local = t - board.narrationStart;
  const progress = local / Math.max(0.001, board.narrationEnd - board.narrationStart);
  const frameIndex = Math.floor(local * FPS);
  const mouth = envelope ? (envelope[Math.min(envelope.length - 1, frameIndex)] ?? 0) : 0;

  // Header
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = "700 26px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
  ctx.fillText(wrapLines(ctx, board.title, 620, 1)[0] ?? board.title, 56, 66);

  ctx.fillStyle = FAINT;
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(board.subtitle.toUpperCase(), 56, 92);

  let chipX = WIDTH - 56;
  for (const label of [board.levelLabel, board.languageLabel]) {
    ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
    const width = ctx.measureText(label).width + 26;
    chipX -= width;
    chip(ctx, label, chipX, 52);
    chipX -= 10;
  }

  // Presenter, left
  drawPresenter(ctx, 250, 400, 1.05, board.persona, mouth, t);

  // Panel, right
  const panelX = 500;
  const panelY = 128;
  const panelW = WIDTH - panelX - 56;
  const panelH = 400;

  if (board.panel === "code") {
    drawCodePanel(ctx, board, panelX, panelY, panelW, panelH, progress);
  } else if (board.panel === "diagram") {
    drawDiagramPanel(ctx, board, panelX, panelY, panelW, panelH, progress);
  } else {
    drawConceptPanel(ctx, board, panelX, panelY, panelW, progress);
  }

  // Caption for the sentence being spoken right now
  const caption = board.captions.find((entry) => t >= entry.start && t < entry.end);
  if (caption) {
    drawCaption(ctx, caption.text, easeOut((t - caption.start) / 0.22));
  }

  // Progress bar
  const barWidth = WIDTH - 112;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, 56, HEIGHT - 22, barWidth, 5, 3);
  ctx.fill();
  ctx.fillStyle = ACCENT;
  roundRect(ctx, 56, HEIGHT - 22, barWidth * Math.min(1, t / board.duration), 5, 3);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported throws on some older engines rather than returning false.
    }
  }
  return null;
}

export function canExport(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickRecorderMimeType() !== null
  );
}

export interface RecordOptions {
  board: Storyboard;
  narration: Narration | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Records the lesson to a video file, in real time.
 *
 * The canvas is driven by the same paintFrame the preview uses, and the
 * narration is routed through a MediaStreamAudioDestinationNode so its track
 * joins the same recording — which is why the download has sound and stays in
 * sync with the mouth rather than being a silent screen capture.
 */
export async function recordLesson({
  board,
  narration,
  onProgress,
  signal,
}: RecordOptions): Promise<Blob> {
  const mimeType = pickRecorderMimeType();
  if (!mimeType) {
    throw new Error("This browser can't record video. Try Chrome or Edge.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't create a canvas to render into.");

  const stream = canvas.captureStream(FPS);

  let audioContext: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;

  if (narration) {
    try {
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        audioContext = new AudioCtor();
        const destination = audioContext.createMediaStreamDestination();
        source = audioContext.createBufferSource();
        source.buffer = narration.buffer;
        source.connect(destination);
        for (const track of destination.stream.getAudioTracks()) {
          stream.addTrack(track);
        }
      }
    } catch (error) {
      // A video with captions and no narration is still a lesson video.
      console.warn("Narration track unavailable for export:", error);
      audioContext = null;
      source = null;
    }
  }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error("Recording failed partway through."));
  });

  recorder.start(200);

  const startedAt = performance.now();
  if (audioContext && source) {
    try {
      await audioContext.resume();
      source.start(audioContext.currentTime + board.narrationStart);
    } catch {
      // Autoplay policy can refuse a fresh context; carry on silent.
    }
  }

  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      if (signal?.aborted || elapsed >= board.duration) {
        resolve();
        return;
      }
      paintFrame(ctx, board, elapsed, narration?.envelope ?? null);
      onProgress?.(Math.min(1, elapsed / board.duration));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // A final frame, so the file never ends on a half-drawn canvas.
  paintFrame(ctx, board, board.duration - 0.01, narration?.envelope ?? null);

  try {
    recorder.stop();
  } catch {
    // Already stopped — the promise below still settles.
  }
  try {
    source?.stop();
    await audioContext?.close();
  } catch {
    // Nothing to clean up.
  }

  onProgress?.(1);
  return finished;
}
