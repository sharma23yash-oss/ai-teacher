"use client";

import { Player } from "@remotion/player";
import { PlaceholderComposition } from "./placeholder-composition";

const FPS = 30;
const DURATION_SECONDS = 8;

export function VideoStage({ caption }: { caption: string }) {
  return (
    <Player
      component={PlaceholderComposition}
      inputProps={{ caption }}
      durationInFrames={FPS * DURATION_SECONDS}
      fps={FPS}
      compositionWidth={1280}
      compositionHeight={720}
      style={{ width: "100%", height: "100%" }}
      controls
      loop
      autoPlay
      clickToPlay={false}
    />
  );
}
