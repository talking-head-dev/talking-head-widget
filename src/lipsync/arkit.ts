/**
 * The 52 ARKit blendshape names every lip-sync method and the performance layer speak, and **the mixing rules**:
 * which names belong to the mouth (lip sync owns them) and which to the face (the performance layer: emotions,
 * glances, blinks). The head's GLB names them with `_L`/`_R` suffixes; `lib/blendshapes.ts` translates.
 *
 * Mixing (`mixFrame`):
 * - **Mouth** names come from the lip-sync layer. The performance layer may add only the expressive mouth shapes
 *   (`EXPRESSIVE_MOUTH`: smile, frown, press, dimple), scaled down while the mouth is speaking, so an emotion still
 *   shows without fighting the visemes.
 * - **Face** names come from the performance layer, plus whatever face values the lip-sync layer carries (the webcam
 *   method tracks brows and eyes too).
 * - Every result is clamped to 0..1. **Head pose** (yaw, pitch, roll in degrees) is not a blendshape: each layer's
 *   pose adds on (`addPose`).
 */

/** ARKit's 52 blendshapes, in MediaPipe's order (its `_neutral` dropped). */
export const ARKIT_NAMES = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekPuff",
  "cheekSquintLeft", "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight",
  "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
  "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
  "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft",
  "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "noseSneerLeft", "noseSneerRight", "tongueOut",
] as const;

export type ArkitName = (typeof ARKIT_NAMES)[number];

const ARKIT_SET: ReadonlySet<string> = new Set(ARKIT_NAMES);
export const isArkitName = (name: string): name is ArkitName => ARKIT_SET.has(name);

/** The mouth: lip sync owns these. */
export const MOUTH_NAMES: readonly ArkitName[] = ARKIT_NAMES.filter(
  (n) => n.startsWith("mouth") || n.startsWith("jaw") || n === "cheekPuff" || n === "tongueOut",
);
const MOUTH_SET: ReadonlySet<string> = new Set(MOUTH_NAMES);
export const isMouthName = (name: string): boolean => MOUTH_SET.has(name);

/** The face: brows, eyes, cheek squint, nose: the performance layer's. */
export const FACE_NAMES: readonly ArkitName[] = ARKIT_NAMES.filter((n) => !MOUTH_SET.has(n));

/** Mouth shapes an emotion may still add while lip sync drives the mouth. */
export const EXPRESSIVE_MOUTH: readonly ArkitName[] = [
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthPressLeft", "mouthPressRight",
  "mouthDimpleLeft", "mouthDimpleRight",
];
const EXPRESSIVE_SET: ReadonlySet<string> = new Set(EXPRESSIVE_MOUTH);

/** How much of an expressive mouth shape is left at full speech (jawOpen ≥ SPEAKING_FULL_JAW). */
export const SPEAKING_KEEP = 0.4;
export const SPEAKING_FULL_JAW = 0.35;

/** A set of weights by ARKit name; names not present are 0. */
export type Weights = Partial<Record<ArkitName, number>>;

/** Head pose in degrees: yaw + turns to the viewer's right, pitch + looks up, roll + tilts to the viewer's right. */
export interface Pose {
  yaw: number;
  pitch: number;
  roll: number;
}

export const ZERO_POSE: Pose = Object.freeze({ yaw: 0, pitch: 0, roll: 0 });

export function addPose(...poses: Pose[]): Pose {
  return poses.reduce((a, p) => ({ yaw: a.yaw + p.yaw, pitch: a.pitch + p.pitch, roll: a.roll + p.roll }), {
    yaw: 0, pitch: 0, roll: 0,
  });
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How much the mouth is speaking, 0..1, from the lip layer's jaw. */
export function speakingAmount(lip: Weights): number {
  return clamp01((lip.jawOpen ?? 0) / SPEAKING_FULL_JAW);
}

/**
 * Mix a lip-sync frame and a performance frame by the rules above. `speaking` (0..1) overrides how much the mouth is
 * speaking (the live screen knows from playback); by default it's read from the lip frame's jaw.
 */
export function mixFrame(lip: Weights, performance: Weights, speaking = speakingAmount(lip)): Weights {
  const out: Weights = {};
  const keep = 1 - (1 - SPEAKING_KEEP) * clamp01(speaking);
  for (const name of ARKIT_NAMES) {
    const l = lip[name] ?? 0;
    const p = performance[name] ?? 0;
    let v: number;
    if (MOUTH_SET.has(name)) v = l + (EXPRESSIVE_SET.has(name) ? p * keep : 0);
    else v = l + p;
    if (v !== 0) out[name] = clamp01(v);
  }
  return out;
}

/** Add weight sets (clamped later by `mixFrame` or the viewport). */
export function addWeights(...sets: Weights[]): Weights {
  const out: Weights = {};
  for (const set of sets) {
    for (const [name, v] of Object.entries(set) as [ArkitName, number][]) out[name] = (out[name] ?? 0) + v;
  }
  return out;
}

/** Multiply every weight by `k`. */
export function scaleWeights(set: Weights, k: number): Weights {
  const out: Weights = {};
  for (const [name, v] of Object.entries(set) as [ArkitName, number][]) out[name] = v * k;
  return out;
}
