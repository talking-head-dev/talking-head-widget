/**
 * The "alive" previews' loop (avatar and head pages, `views/shared/AliveHead.tsx`): one of the five emotions every
 * `LOOP_STEP` seconds, each held `LOOP_HOLD`, starting a second in.
 */
import { EMOTIONS, type Emotion } from "./presets";

export const LOOP_STEP = 2.6;
export const LOOP_HOLD = 1.2;

/** Which emotion of the loop is showing at `t` (seconds), the loop having started at `start`; null between them. */
export function loopEmotion(t: number, start: number): Emotion | null {
  const k = Math.floor((t - start - 1) / LOOP_STEP);
  if (k < 0) return null;
  const phase = t - start - 1 - k * LOOP_STEP;
  return phase < LOOP_HOLD + 0.8 ? EMOTIONS[k % EMOTIONS.length] : null;
}
