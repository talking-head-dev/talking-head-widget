/**
 * **H3: the performance layer.** Everything the face does that isn't the mouth speaking: a base mood, emotion
 * moments, glances, the "I heard you" nod and the idle layer, evaluated at any time into ARKit weights and a head
 * pose, which `lib/lipsync/arkit.ts mixFrame` puts over the lip-sync layer (lip sync owns the mouth; the smile and
 * frown are scaled down while it speaks; the pose adds on).
 *
 * Two inputs: the studio pipeline's `schedule.json` (times already resolved: `loadSchedule`), and a live form, one
 * cue at a time (`emote`, `look`, `sentence`, `nod`), each at a time on the same clock or "now".
 */
import { addPose, addWeights, scaleWeights, type Pose, type Weights } from "../lipsync/arkit";
import { IdleLayer } from "./idle";
import {
  EMOTE_HOLD, EMOTE_LEAD, EMOTE_RAMP, GLANCE, INTENSITY, LOOK_HOLD, LOOK_RAMP, emotionWeights, envelope, lookWeights,
  type Direction, type Intensity, type ReplyEmotion,
} from "./presets";

/** The studio pipeline's schedule.json (pipeline.py `make_schedule`). */
export interface StudioSchedule {
  /** The base mood, "happy:0.35", or null. */
  emotion: string | null;
  emotes: { t: number; emotion: ReplyEmotion; strength: number; hold: number; quote?: string }[];
  looks: { t: number; yaw: number; pitch: number; hold: number; quote?: string }[];
  skipped?: unknown[];
}

interface EmoteCue { t: number; emotion: ReplyEmotion; strength: number; hold: number }
interface LookCue { t: number; yaw: number; pitch: number; hold: number }

/** "I heard you": a nod (down and back) with a hint of a smile, while an acknowledgement ("Okay.") plays. */
export const NOD = { duration: 0.7, pitch: -6, smile: 0.15 } as const;

/** A live reply sentence's glance comes this far into the sentence. */
export const SENTENCE_GLANCE_AT = 0.2;

export interface PerformanceFrame {
  weights: Weights;
  pose: Pose;
}

export class Performer {
  private emotes: EmoteCue[] = [];
  private looks: LookCue[] = [];
  private nods: number[] = [];
  private speech: [number, number][] = [];
  private baseMood: { emotion: ReplyEmotion; strength: number } | null = null;
  private idle: IdleLayer;
  private readonly seed: number;
  /** The clock "now" means (seconds). */
  now: () => number;

  constructor(options: { seed?: number; now?: () => number } = {}) {
    this.seed = options.seed ?? 1;
    this.now = options.now ?? (() => performance.now() / 1000);
    this.idle = new IdleLayer(this.seed, (t) => this.isSpeaking(t));
  }

  /** Forget every cue and start the idle layer over (the same seed: a replay looks the same). */
  reset(): void {
    this.emotes = [];
    this.looks = [];
    this.nods = [];
    this.speech = [];
    this.baseMood = null;
    this.idle = new IdleLayer(this.seed, (t) => this.isSpeaking(t));
  }

  /** Move to another clock (the live screen's moves to the reply player's once it exists). */
  setClock(now: () => number): void {
    this.now = now;
  }

  private at(t: number | "now"): number {
    return t === "now" ? this.now() : t;
  }

  setBaseMood(emotion: ReplyEmotion | null, strength = 0.35): void {
    this.baseMood = emotion && emotion !== "neutral" ? { emotion, strength } : null;
  }

  /** An emotion moment starting at `t` (the expression's own start: the lead is the caller's, as in schedule.json). */
  emote(t: number | "now", emotion: ReplyEmotion, strength = 1, hold = EMOTE_HOLD): void {
    if (emotion === "neutral") return;
    this.emotes.push({ t: this.at(t), emotion, strength, hold });
  }

  /** A glance: a direction (pipeline.py's GLANCE) or degrees, starting at `t`. */
  look(t: number | "now", direction: Direction | { yaw: number; pitch: number }, hold = LOOK_HOLD): void {
    const deg = typeof direction === "string" ? GLANCE[direction] : direction;
    if (!deg) return;
    this.looks.push({ t: this.at(t), yaw: deg.yaw, pitch: deg.pitch, hold });
  }

  /** The "I heard you" reaction at `t`. */
  nod(t: number | "now" = "now"): void {
    this.nods.push(this.at(t));
  }

  /** The head speaks from `start` for `duration` seconds (blinks come faster, the head moves more). */
  speak(start: number, duration: number): void {
    this.speech.push([start, start + Math.max(0, duration)]);
  }

  isSpeaking(t: number): boolean {
    return this.speech.some(([a, b]) => t >= a && t <= b);
  }

  /**
   * A live reply sentence starting at `start` (when its audio starts) and lasting `duration`: its emotion from
   * `EMOTE_LEAD` before (never before now), held for the sentence; its glance a moment in.
   */
  sentence(start: number | "now", label: { emotion: ReplyEmotion; intensity: Intensity; glance: Direction | null },
    duration: number): void {
    const s = this.at(start);
    this.speak(s, duration);
    if (label.emotion !== "neutral") {
      const t = Math.max(this.now(), s - EMOTE_LEAD);
      this.emote(t, label.emotion, INTENSITY[label.intensity] ?? 1, Math.max(0.8, s + duration - t - EMOTE_RAMP.in));
    }
    if (label.glance) this.look(s + SENTENCE_GLANCE_AT, label.glance, Math.min(1.6, Math.max(0.8, duration * 0.5)));
  }

  /** The studio's schedule.json, its times on this clock from `offset` (the clip's start). */
  loadSchedule(schedule: StudioSchedule, offset = 0): void {
    if (schedule.emotion) {
      const [name, strength] = schedule.emotion.split(":");
      this.setBaseMood(name as ReplyEmotion, strength ? Number(strength) : 1);
    }
    for (const e of schedule.emotes ?? []) this.emote(offset + e.t, e.emotion, e.strength, e.hold);
    for (const l of schedule.looks ?? []) this.look(offset + l.t, { yaw: l.yaw, pitch: l.pitch }, l.hold);
  }

  /** Every cue's time (sorted): where the dev route takes its screenshots. */
  cueTimes(): { t: number; kind: "emote" | "look" | "nod"; label: string }[] {
    return [
      ...this.emotes.map((e) => ({ t: e.t, kind: "emote" as const, label: `${e.emotion} ${e.strength}` })),
      ...this.looks.map((l) => ({ t: l.t, kind: "look" as const, label: `${l.yaw}° ${l.pitch}°` })),
      ...this.nods.map((t) => ({ t, kind: "nod" as const, label: "nod" })),
    ].sort((a, b) => a.t - b.t);
  }

  /** Weights and pose at `t` (idle included unless `idle: false`). */
  evaluate(t: number, options: { idle?: boolean } = {}): PerformanceFrame {
    const layers: Weights[] = [];
    const poses: Pose[] = [];
    if (this.baseMood) layers.push(emotionWeights(this.baseMood.emotion, this.baseMood.strength));
    for (const e of this.emotes) {
      const w = envelope(t, e.t, e.hold, EMOTE_RAMP.in, EMOTE_RAMP.out);
      if (w > 0) layers.push(scaleWeights(emotionWeights(e.emotion, e.strength), w));
    }
    for (const l of this.looks) {
      const w = envelope(t, l.t, l.hold, LOOK_RAMP.in, LOOK_RAMP.out);
      if (w <= 0) continue;
      const look = lookWeights(l.yaw * w, l.pitch * w);
      layers.push(look.weights);
      poses.push(look.pose);
    }
    for (const n of this.nods) {
      const d = (t - n) / NOD.duration;
      if (d < 0 || d > 1) continue;
      const s = Math.sin(Math.PI * d);
      poses.push({ yaw: 0, pitch: NOD.pitch * s * s, roll: 0 });
      layers.push({ mouthSmileLeft: NOD.smile * s, mouthSmileRight: NOD.smile * s });
    }
    if (options.idle !== false) {
      const idle = this.idle.evaluate(t);
      layers.push(idle.weights);
      poses.push(idle.pose);
    }
    return { weights: addWeights(...layers), pose: addPose(...poses) };
  }
}
