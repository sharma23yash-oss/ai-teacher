import type { LessonSummary } from "@/lib/learning/summary";

/**
 * Draws the end-of-lesson summary as a 1080x1350 PNG (portrait, the size
 * WhatsApp and Instagram show without cropping). It contains only the topic,
 * concept names, percentages and the streak: nothing that identifies the
 * student.
 */
const WIDTH = 1080;
const HEIGHT = 1350;
const PAD = 80;
const FONT = `system-ui, -apple-system, "Segoe UI", "Noto Sans", "Noto Sans Devanagari", sans-serif`;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(" ") !== lines.join(" ")) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/\s*\S*$/, "")}…`;
  }
  return lines;
}

export function drawSummaryImage(summary: LessonSummary, siteName: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, "#1e1b4b");
  bg.addColorStop(1, "#020617");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  let y = PAD + 20;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#a5b4fc";
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText("🎓 AI Teacher · Lesson summary", PAD, y);
  y += 80;

  ctx.fillStyle = "#ffffff";
  ctx.font = `700 60px ${FONT}`;
  for (const line of wrap(ctx, summary.topic, WIDTH - PAD * 2, 3)) {
    ctx.fillText(line, PAD, y);
    y += 74;
  }
  y += 30;

  const section = (title: string, colour: string, items: string[], empty: string) => {
    ctx.fillStyle = colour;
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(title, PAD, y);
    y += 56;
    ctx.fillStyle = "#e2e8f0";
    ctx.font = `400 34px ${FONT}`;
    const shown = items.length > 0 ? items.slice(0, 5) : [empty];
    for (const item of shown) {
      for (const line of wrap(ctx, item, WIDTH - PAD * 2 - 40, 2)) {
        ctx.fillText(line, PAD + 40, y);
        y += 46;
      }
    }
    if (items.length > 5) {
      ctx.fillText(`+ ${items.length - 5} more`, PAD + 40, y);
      y += 46;
    }
    y += 30;
  };

  const withPercent = (c: { label: string; percent: number | null }) =>
    c.percent === null ? `• ${c.label}` : `• ${c.label} (${c.percent}%)`;

  section("✅ What I learned", "#6ee7b7", summary.learned.map(withPercent), "• Building up: a few more rounds to go");
  section("🎯 Weak spots", "#fcd34d", summary.weak.map(withPercent), "• None this time");
  section("➡️ Next step", "#a5b4fc", [summary.nextStep], "");

  ctx.fillStyle = "#fdba74";
  ctx.font = `700 40px ${FONT}`;
  if (summary.streak > 0) {
    ctx.fillText(`🔥 ${summary.streak}-day learning streak`, PAD, HEIGHT - PAD - 110);
  }
  ctx.fillStyle = "#94a3b8";
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText(siteName, PAD, HEIGHT - PAD - 40);

  return canvas;
}

export function canvasToPngFile(canvas: HTMLCanvasElement, fileName: string): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? new File([blob], fileName, { type: "image/png" }) : null), "image/png");
  });
}
