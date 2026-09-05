"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import type { Group } from "three";
import { PERSONA_COLORS, type TeacherPersona } from "@/lib/types";

// Placeholder 3D avatar — swap the mesh below for a rigged glTF model
// (useGLTF + drei's <primitive>) once the avatar asset is ready. Shared by
// the full AvatarScene and the compact AvatarOverlay (PiP) so both stay in
// sync visually.
export function AvatarMesh({
  isSpeaking,
  persona,
}: {
  isSpeaking: boolean;
  persona: TeacherPersona;
}) {
  const bodyRef = useRef<Group>(null);
  const { head, body: bodyColor } = PERSONA_COLORS[persona];

  useFrame((state) => {
    const body = bodyRef.current;
    if (!body) return;
    const t = state.clock.elapsedTime;

    if (isSpeaking) {
      // Faster, more pronounced bounce/scale pulse to simulate talking.
      const talk = Math.sin(t * 10);
      body.scale.y = 1 + talk * 0.06;
      body.position.y = -0.4 + Math.abs(talk) * 0.05;
    } else {
      // Slow, subtle sine wave to simulate idle breathing.
      const breathe = Math.sin(t * 1.5);
      body.scale.y = 1 + breathe * 0.02;
      body.position.y = -0.4;
    }
  });

  return (
    <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.6}>
      <group ref={bodyRef} position={[0, -0.4, 0]}>
        <mesh position={[0, 1.4, 0]}>
          <sphereGeometry args={[0.5, 32, 32]} />
          <meshStandardMaterial color={head} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <capsuleGeometry args={[0.55, 1, 8, 16]} />
          <meshStandardMaterial color={bodyColor} roughness={0.4} />
        </mesh>
      </group>
    </Float>
  );
}
