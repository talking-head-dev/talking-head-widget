/**
 * **H3: the studio's labels as ARKit weights.** The five emotions (talking-head-render/emotions.py `PRESETS`,
 * talking-head-pipeline/label.py `EMOTIONS`; live replies add neutral) as blendshape presets, label.py's intensities,
 * pipeline.py's glance directions with their degrees, and talk.py's rise and fade curves. The presets are this app's
 * own (SadTalker's 3DMM coefficients don't translate); the names, strengths, degrees and curves repeat the studio's
 * and must stay in sync with it (the workspace CLAUDE.md lists them).
 */
import type { Pose, Weights } from "../lipsync/arkit";

export const EMOTIONS = ["happy", "sad", "surprised", "interested", "concerned"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export type ReplyEmotion = Emotion | "neutral";

/** Strength 1.0: a clear, natural expression (as emotions.py's 1.0). */
export const EMOTION_PRESETS: Record<ReplyEmotion, Weights> = {
  neutral: {},
  // The ICT head's cheekSquint lifts the lower lids a lot: past ~0.3 a smile reads as closed eyes.
  happy: { mouthSmileLeft: 0.6, mouthSmileRight: 0.6, cheekSquintLeft: 0.25, cheekSquintRight: 0.25, eyeSquintLeft: 0.08,
    eyeSquintRight: 0.08 },
  sad: { mouthFrownLeft: 0.5, mouthFrownRight: 0.5, browInnerUp: 0.6, eyeLookDownLeft: 0.12, eyeLookDownRight: 0.12 },
  surprised: { browInnerUp: 0.6, browOuterUpLeft: 0.7, browOuterUpRight: 0.7, eyeWideLeft: 0.6, eyeWideRight: 0.6 },
  interested: { browOuterUpLeft: 0.5, browOuterUpRight: 0.5, mouthSmileLeft: 0.2, mouthSmileRight: 0.2 },
  concerned: { browInnerUp: 0.6, mouthPressLeft: 0.4, mouthPressRight: 0.4, browDownLeft: 0.1, browDownRight: 0.1 },
};

/** label.py `INTENSITY`. */
export const INTENSITY = { subtle: 0.5, clear: 1.0, strong: 1.4 } as const;
export type Intensity = keyof typeof INTENSITY;
/** label.py `BASE_INTENSITY`: the base mood under a whole video. */
export const BASE_INTENSITY = { low: 0.2, medium: 0.35 } as const;

/** pipeline.py `EMOTE_LEAD`: an expression starts this long before its words. */
export const EMOTE_LEAD = 0.3;
/** talk.py: emotes ramp in over 0.5 s and out over 0.8 s; glances 0.4 s and 0.6 s; both smoothstep. */
export const EMOTE_RAMP = { in: 0.5, out: 0.8 } as const;
export const LOOK_RAMP = { in: 0.4, out: 0.6 } as const;
/** talk.py's defaults when a cue gives no hold. */
export const EMOTE_HOLD = 1.5;
export const LOOK_HOLD = 1.2;

export const DIRECTIONS = ["left", "right", "down-left", "down-right", "up-left", "up-right"] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** pipeline.py `GLANCE`: degrees as seen by the viewer (yaw + = the viewer's right, pitch + = up). */
export const GLANCE: Record<Direction, { yaw: number; pitch: number }> = {
  left: { yaw: -18, pitch: 0 }, right: { yaw: 18, pitch: 0 }, "down-left": { yaw: -15, pitch: -6 },
  "down-right": { yaw: 15, pitch: -6 }, "up-left": { yaw: -15, pitch: 5 }, "up-right": { yaw: 15, pitch: 5 },
};

/**
 * How much of a glance the head turns; the eyes do the rest. The studio turns the whole image (the renderer has no
 * eyes of their own); a 3D head looks more natural leading with the eyes.
 */
export const HEAD_SHARE = 0.55;
/** Degrees of eye turn at which an eyeLook shape is at 1. */
export const EYE_FULL_DEG = 25;

/** talk.py `envelope`: 0 → 1 over `rampIn` from `start` (smoothstep), held `hold` s, back to 0 over `rampOut`. */
export function envelope(t: number, start: number, hold: number, rampIn: number, rampOut: number): number {
  const w = Math.min(Math.max((t - start) / rampIn, 0), 1, Math.max((start + rampIn + hold + rampOut - t) / rampOut, 0));
  return w * w * (3 - 2 * w);
}

/** An emotion at a strength as weights (each clamped to 1). */
export function emotionWeights(emotion: ReplyEmotion, strength: number): Weights {
  const out: Weights = {};
  for (const [name, v] of Object.entries(EMOTION_PRESETS[emotion] ?? {})) {
    out[name as keyof Weights] = Math.min(1, (v as number) * strength);
  }
  return out;
}

/**
 * A look (viewer's degrees) as a head pose and eye shapes: the head turns `HEAD_SHARE` of it, the eyes the rest. To
 * the viewer's right is the head's own left: the left eye looks out, the right eye in.
 */
export function lookWeights(yaw: number, pitch: number): { pose: Pose; weights: Weights } {
  const eyeYaw = yaw * (1 - HEAD_SHARE);
  const eyePitch = pitch * (1 - HEAD_SHARE) * 2; // pitch is small in the table; the eyes carry it
  const h = Math.min(1, Math.abs(eyeYaw) / EYE_FULL_DEG);
  const v = Math.min(1, Math.abs(eyePitch) / EYE_FULL_DEG);
  const weights: Weights = {};
  if (eyeYaw > 0) Object.assign(weights, { eyeLookOutLeft: h, eyeLookInRight: h });
  if (eyeYaw < 0) Object.assign(weights, { eyeLookOutRight: h, eyeLookInLeft: h });
  if (eyePitch > 0) Object.assign(weights, { eyeLookUpLeft: v, eyeLookUpRight: v });
  if (eyePitch < 0) Object.assign(weights, { eyeLookDownLeft: v, eyeLookDownRight: v });
  return { pose: { yaw: yaw * HEAD_SHARE, pitch: pitch * HEAD_SHARE, roll: 0 }, weights };
}
