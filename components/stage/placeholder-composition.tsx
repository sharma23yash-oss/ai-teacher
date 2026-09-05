import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Minimal Remotion composition so <Player> has something to render before
// the real lesson-video composition (driven by avatar_script / visual_director) is built.
export function PlaceholderComposition({ caption }: { caption: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({ frame, fps, config: { damping: 200 } });
  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill className="items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950">
      <div
        style={{ transform: `scale(${scale})`, opacity }}
        className="flex flex-col items-center gap-4 px-12 text-center"
      >
        <div className="h-3 w-3 animate-pulse rounded-full bg-indigo-400" />
        <p className="max-w-xl text-2xl font-medium text-slate-100">
          {caption}
        </p>
      </div>
    </AbsoluteFill>
  );
}
