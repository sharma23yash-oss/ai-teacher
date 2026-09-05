"use client";

import {
  GESTURE_SIGNAL_META,
  type GestureSignal,
  type VideoRefCallback,
} from "@/lib/types";

// Compact picture-in-picture webcam preview shown while a live video call is
// active and the Stage is showing something other than the call itself.
// Mirrors the AvatarOverlay pattern but docks opposite it (bottom-left vs.
// bottom-right) so the two never overlap.
export function VideoCallOverlay({
  videoRef,
  lastSignal,
  isTracking,
}: {
  videoRef: VideoRefCallback;
  lastSignal: GestureSignal | null;
  isTracking: boolean;
}) {
  return (
    <div
      className={`absolute bottom-4 left-4 h-28 w-36 overflow-hidden rounded-2xl border bg-black shadow-lg transition-colors sm:h-32 sm:w-44 ${
        isTracking ? "border-emerald-400/50" : "border-white/15"
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="h-full w-full -scale-x-100 object-cover"
      />
      <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-red-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        LIVE
      </div>
      {lastSignal && (
        <div className="gesture-pop absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5 rounded-lg bg-black/75 px-2 py-1 backdrop-blur-sm">
          <span className="text-sm leading-none">{GESTURE_SIGNAL_META[lastSignal].glyph}</span>
          <span className={`text-[10px] font-medium ${GESTURE_SIGNAL_META[lastSignal].tone}`}>
            {GESTURE_SIGNAL_META[lastSignal].meaning}
          </span>
        </div>
      )}
    </div>
  );
}
