"use client";

import type { DiagramData, DiagramNodeStatus } from "@/lib/types";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const COL_GAP = 36;
const ROW_GAP = 64;
const PADDING = 32;

interface Layout {
  positions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}

// Simple longest-path leveling (BFS from in-degree-0 roots) so branching
// flows read top-to-bottom without pulling in a full graph-layout library.
function computeLayout(data: DiagramData): Layout {
  const ids = data.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>();

  for (const edge of data.edges) {
    if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }

  const level = new Map<string, number>();
  const roots = ids.filter((id) => (incoming.get(id) ?? 0) === 0);
  const initialFrontier = roots.length > 0 ? roots : ids.slice(0, 1);
  initialFrontier.forEach((id) => level.set(id, 0));

  const visited = new Set(initialFrontier);
  let frontier = initialFrontier;
  let guard = 0;
  while (frontier.length > 0 && guard < ids.length + 1) {
    guard++;
    const next: string[] = [];
    for (const id of frontier) {
      const lvl = level.get(id) ?? 0;
      for (const target of adjacency.get(id) ?? []) {
        const proposed = lvl + 1;
        if (!visited.has(target)) {
          visited.add(target);
          level.set(target, proposed);
          next.push(target);
        } else if ((level.get(target) ?? 0) < proposed) {
          level.set(target, proposed);
        }
      }
    }
    frontier = next;
  }
  ids.forEach((id) => {
    if (!level.has(id)) level.set(id, 0);
  });

  const byLevel = new Map<number, string[]>();
  ids.forEach((id) => {
    const lvl = level.get(id) ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(id);
  });

  const levels = Array.from(byLevel.keys());
  const numLevels = levels.length > 0 ? Math.max(...levels) + 1 : 1;
  const maxPerLevel = Math.max(1, ...Array.from(byLevel.values()).map((l) => l.length));

  const colWidth = NODE_WIDTH + COL_GAP;
  const rowHeight = NODE_HEIGHT + ROW_GAP;
  const width = maxPerLevel * colWidth - COL_GAP + PADDING * 2;
  const height = numLevels * rowHeight - ROW_GAP + PADDING * 2;

  const positions = new Map<string, { x: number; y: number }>();
  byLevel.forEach((idsInLevel, lvl) => {
    const levelWidth = idsInLevel.length * colWidth - COL_GAP;
    const startX = (width - levelWidth) / 2;
    idsInLevel.forEach((id, idx) => {
      positions.set(id, { x: startX + idx * colWidth, y: PADDING + lvl * rowHeight });
    });
  });

  return { positions, width, height };
}

const STATUS_STYLES: Record<DiagramNodeStatus | "default", string> = {
  active:
    "border-indigo-400 bg-indigo-500/20 text-indigo-100 shadow-[0_0_20px_rgba(129,140,248,0.35)] animate-pulse",
  success: "border-emerald-400/70 bg-emerald-500/15 text-emerald-100",
  warning: "border-amber-400/70 bg-amber-500/15 text-amber-100",
  default: "border-white/15 bg-white/5 text-slate-200",
};

export function DiagramStage({ data }: { data: DiagramData }) {
  if (data.nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">
        No diagram data for this step.
      </div>
    );
  }

  const { positions, width, height } = computeLayout(data);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
      <div className="relative" style={{ width, height }}>
        <svg
          width={width}
          height={height}
          className="pointer-events-none absolute inset-0"
        >
          <defs>
            <marker
              id="diagram-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill="#818cf8" />
            </marker>
          </defs>
          {data.edges.map((edge, i) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_WIDTH / 2;
            const y1 = from.y + NODE_HEIGHT;
            const x2 = to.x + NODE_WIDTH / 2;
            const y2 = to.y;
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            return (
              <g key={i}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#818cf8"
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  className="diagram-edge-flow"
                  markerEnd="url(#diagram-arrow)"
                />
                {edge.label && (
                  <>
                    <rect
                      x={midX - edge.label.length * 3.2 - 4}
                      y={midY - 9}
                      width={edge.label.length * 6.4 + 8}
                      height={18}
                      rx={9}
                      fill="#0f172a"
                      stroke="#818cf8"
                      strokeWidth={1}
                    />
                    <text
                      x={midX}
                      y={midY + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#c7d2fe"
                    >
                      {edge.label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {data.nodes.map((node, i) => {
          const pos = positions.get(node.id);
          if (!pos) return null;
          return (
            <div
              key={node.id}
              className={`diagram-node-in absolute flex items-center justify-center rounded-xl border px-3 text-center text-sm font-medium leading-snug ${
                STATUS_STYLES[node.status ?? "default"]
              }`}
              style={{
                left: pos.x,
                top: pos.y,
                width: NODE_WIDTH,
                height: NODE_HEIGHT,
                animationDelay: `${i * 80}ms`,
              }}
            >
              {node.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}
