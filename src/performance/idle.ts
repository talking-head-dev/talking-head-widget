/**
 * **The idle layer**: what keeps a head alive between and under everything else. Procedural blinks (3-5 s apart,
 * faster while talking, now and then a double blink), small head and eye motion, breathing. Seeded, and a pure
 * function of time given the speech intervals, so a replay (the same seed, the same audio) looks the same frame for
 * frame however the frames are sampled.
 */
import type { Pose, Weights } from "../lipsync/arkit";

/** mulberry32: a small seeded PRNG, uniform in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BLINK = { min: 3, max: 5, talkingFactor: 0.6, close: 0.06, open: 0.1, double: 0.12 } as const;
export const SACCADE = { min: 0.8, max: 2.2, amount: 0.08 } as const;

export class IdleLayer {
  private readonly next: () => number;
  private readonly blinks: number[] = [];
  private readonly saccades: { t: number; h: number; v: number }[] = [];
  private readonly saccadeRng: () => number;
  private readonly phases: number[];
  /** True while the head is speaking at time t (the performer's speech intervals). */
  private readonly speaking: (t: number) => boolean;

  constructor(seed: number, speaking: (t: number) => boolean = () => false) {
    this.next = rng(seed);
    this.saccadeRng = rng(seed ^ 0x5bd1e995);
    const p = rng(seed ^ 0x9e3779b9);
    this.phases = Array.from({ length: 6 }, () => p() * Math.PI * 2);
    this.speaking = speaking;
    this.blinks.push(0.5 + this.next() * 2);
  }

  /** Blink start times up to `t` (computed once, in order, so they never depend on when they were asked for). */
  blinkTimes(until: number): number[] {
    while (this.blinks[this.blinks.length - 1] <= until + 1) {
      const last = this.blinks[this.blinks.length - 1];
      const u = this.next();
      if (u < 0.1) this.blinks.push(last + BLINK.close + BLINK.open + BLINK.double); // a double blink
      const factor = this.speaking(last) ? BLINK.talkingFactor : 1;
      this.blinks.push(last + (BLINK.min + (BLINK.max - BLINK.min) * this.next()) * factor);
    }
    return this.blinks.filter((b) => b <= until);
  }

  private blinkAt(t: number): number {
    let w = 0;
    for (const b of this.blinkTimes(t).slice(-3)) {
      const d = t - b;
      if (d < 0 || d > BLINK.close + BLINK.open) continue;
      const v = d < BLINK.close ? d / BLINK.close : 1 - (d - BLINK.close) / BLINK.open;
      w = Math.max(w, v * v * (3 - 2 * v));
    }
    return w;
  }

  private saccadeAt(t: number): { h: number; v: number } {
    if (this.saccades.length === 0) this.saccades.push({ t: 0, h: 0, v: 0 });
    while (this.saccades[this.saccades.length - 1].t <= t) {
      const last = this.saccades[this.saccades.length - 1];
      const r = this.saccadeRng;
      this.saccades.push({ t: last.t + SACCADE.min + (SACCADE.max - SACCADE.min) * r(),
        h: (r() * 2 - 1) * SACCADE.amount, v: (r() * 2 - 1) * SACCADE.amount * 0.6 });
    }
    let i = this.saccades.length - 1;
    while (i > 0 && this.saccades[i].t > t) i--;
    return this.saccades[i];
  }

  /** Weights and pose at time `t` (seconds). */
  evaluate(t: number): { weights: Weights; pose: Pose } {
    const blink = this.blinkAt(t);
    const s = this.saccadeAt(t);
    const weights: Weights = { eyeBlinkLeft: blink, eyeBlinkRight: blink };
    if (s.h > 0) Object.assign(weights, { eyeLookOutLeft: s.h, eyeLookInRight: s.h });
    if (s.h < 0) Object.assign(weights, { eyeLookOutRight: -s.h, eyeLookInLeft: -s.h });
    if (s.v > 0) Object.assign(weights, { eyeLookUpLeft: s.v, eyeLookUpRight: s.v });
    if (s.v < 0) Object.assign(weights, { eyeLookDownLeft: -s.v, eyeLookDownRight: -s.v });
    const [a, b, c, d, e, f] = this.phases;
    const talk = this.speaking(t) ? 1.6 : 1;
    const pose: Pose = {
      yaw: talk * (1.2 * Math.sin(0.31 * t + a) + 0.5 * Math.sin(0.83 * t + b)),
      // breathing (~4.5 s a breath) plus drift
      pitch: 0.35 * Math.sin((2 * Math.PI * t) / 4.5 + c) + talk * (0.6 * Math.sin(0.47 * t + d)),
      roll: talk * (0.6 * Math.sin(0.23 * t + e) + 0.25 * Math.sin(0.71 * t + f)),
    };
    return { weights, pose };
  }
}
