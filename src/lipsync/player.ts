/**
 * **The timeline player**: plays any `ShapeTimeline` against a clock (an `<audio>` element's `currentTime`, an
 * `AudioContext`'s, a live stream's), interpolating between frames, so a 30 or 100 fps timeline drives a 60 fps head
 * smoothly. It has no renderer of its own: each animation frame the head's loop asks `sample()` for the weights
 * (`lib/three/TalkingHeadViewport.ts` mixes them under the performance layer).
 */
import type { Weights } from "./arkit";
import { frameWeights, sampleTimeline, timelineDuration, type ShapeTimeline } from "./types";

/** A clock in seconds. */
export type Clock = () => number;

export const audioElementClock = (el: HTMLMediaElement): Clock => () => el.currentTime;
export const audioContextClock = (ctx: BaseAudioContext): Clock => () => ctx.currentTime;

/** A clock that starts at 0 when made and runs in real time (`performance.now`), with pause and seek. */
export class ManualClock {
  private origin: number;
  private pausedAt: number | null = null;
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now() / 1000) {
    this.now = now;
    this.origin = now();
  }

  readonly time: Clock = () => (this.pausedAt ?? this.now()) - this.origin;

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.now();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    this.origin += this.now() - this.pausedAt;
    this.pausedAt = null;
  }

  seek(t: number): void {
    const current = this.pausedAt ?? this.now();
    this.origin = current - t;
  }
}

export class TimelinePlayer {
  private readonly timeline: ShapeTimeline;
  private readonly clock: Clock;
  private readonly buffer: Float32Array;
  /** Seconds added to the clock before sampling. */
  offset: number;
  /** A live stream's timeline (`StreamTimeline`): sampled at its newest frames even past its end. */
  private readonly live: boolean;

  constructor(timeline: ShapeTimeline, clock: Clock, options: { offset?: number; live?: boolean } = {}) {
    this.timeline = timeline;
    this.clock = clock;
    this.offset = options.offset ?? 0;
    this.live = options.live ?? false;
    this.buffer = new Float32Array(timeline.names.length);
  }

  get duration(): number {
    return timelineDuration(this.timeline);
  }

  /** The timeline's time now (the clock plus the offset). */
  time(): number {
    return this.clock() + this.offset;
  }

  /** True while the clock is inside the timeline. */
  playing(): boolean {
    const t = this.time() - (this.timeline.start ?? 0);
    return t >= 0 && t <= this.duration;
  }

  /** The weights now; outside the timeline, nothing (the mouth at rest), so a finished clip doesn't hold its last frame. */
  sample(): Weights {
    if (!this.live && !this.playing()) return {};
    sampleTimeline(this.timeline, this.time(), this.buffer);
    return frameWeights(this.timeline.names, this.buffer);
  }

  /** The same, at any time `t` on the timeline (for tests and scrubbing). */
  sampleAt(t: number): Weights {
    sampleTimeline(this.timeline, t, this.buffer);
    return frameWeights(this.timeline.names, this.buffer);
  }
}
