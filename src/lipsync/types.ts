/**
 * **H1: the lip-sync interface.** Every way of moving the mouth (phonemes, word times, the audio's loudness, a
 * webcam, later a neural model) is a `LipSyncMethod`: it takes what it can use from a `LipSyncInput` and makes a
 * `ShapeTimeline` (ARKit weights at a fixed frame rate), all at once or streamed in chunks. One player
 * (`player.ts`) plays any timeline against an audio clock, and the same mixing rules (`arkit.ts`) put it under the
 * performance layer (`lib/performance/`). Timelines travel as JSON (`format.ts`).
 */
import type { ArkitName, Weights } from "./arkit";

/** What a method may work from; each uses what it supports. Times are seconds from the start of the audio. */
export interface LipSyncInput {
  /** Decoded audio (offline analysis). */
  audio?: AudioBuffer;
  /** A live stream: a microphone, a WebRTC peer, a camera (the webcam method reads its video). */
  stream?: MediaStream;
  /** A playing audio node (the live reply player's output): the audio-level method listens to it. */
  node?: AudioNode;
  /** A recorded face video (the webcam method). */
  video?: HTMLVideoElement;
  text?: string;
  words?: { word: string; start: number; end: number }[];
  /** Phonemes with times, or (Kokoro today) without: then `duration` spreads them. */
  phonemes?: { ph: string; start: number; end: number }[];
  /** An IPA string without times (Kokoro's `phonemes`), spread over `duration`. */
  ipa?: string;
  duration?: number;
}

/** ARKit weights sampled at `fps`: `frames[i][j]` is `names[j]` at `i / fps` seconds (from `start`). */
export interface ShapeTimeline {
  fps: number;
  names: ArkitName[];
  frames: Float32Array[];
  /** Seconds on the clock of frame 0 (0 for an offline timeline; a stream's chunks carry their own). */
  start?: number;
}

export type LipSyncMethodId = "phonemes" | "words" | "audio-level" | "webcam" | "neural";

export interface LipSyncMethod {
  id: LipSyncMethodId;
  supports(input: LipSyncInput): boolean;
  run(input: LipSyncInput): Promise<ShapeTimeline> | AsyncIterable<ShapeTimeline>;
}

/** A timeline's length in seconds. */
export const timelineDuration = (tl: ShapeTimeline): number => (tl.frames.length === 0 ? 0 : (tl.frames.length - 1) / tl.fps);

/** A new timeline of `n` zero frames. */
export function emptyTimeline(names: readonly ArkitName[], fps: number, n = 0): ShapeTimeline {
  return { fps, names: [...names], frames: Array.from({ length: n }, () => new Float32Array(names.length)) };
}

/**
 * The weights at `t` seconds, interpolated linearly between the two frames around it (so a 30 or 100 fps timeline
 * plays smoothly at 60 fps). Before the first frame or after the last: that frame. Writes into `out` when given.
 */
export function sampleTimeline(tl: ShapeTimeline, t: number, out?: Float32Array): Float32Array {
  const res = out ?? new Float32Array(tl.names.length);
  const n = tl.frames.length;
  if (n === 0) {
    res.fill(0);
    return res;
  }
  const x = (t - (tl.start ?? 0)) * tl.fps;
  if (x <= 0) {
    res.set(tl.frames[0]);
    return res;
  }
  if (x >= n - 1) {
    res.set(tl.frames[n - 1]);
    return res;
  }
  const i = Math.floor(x);
  const f = x - i;
  const a = tl.frames[i];
  const b = tl.frames[i + 1];
  for (let j = 0; j < res.length; j++) res[j] = a[j] + (b[j] - a[j]) * f;
  return res;
}

/** A frame as weights by name (zeros left out). */
export function frameWeights(names: readonly ArkitName[], frame: ArrayLike<number>): Weights {
  const out: Weights = {};
  for (let j = 0; j < names.length; j++) if (frame[j]) out[names[j]] = frame[j];
  return out;
}

/** Weights by name as a frame over `names`. */
export function weightsFrame(names: readonly ArkitName[], weights: Weights): Float32Array {
  return Float32Array.from(names, (n) => weights[n] ?? 0);
}

/**
 * Resample a timeline to another frame rate (or other names: missing ones are 0), interpolating as `sampleTimeline`.
 */
export function resampleTimeline(tl: ShapeTimeline, fps: number, names: readonly ArkitName[] = tl.names): ShapeTimeline {
  const n = Math.round(timelineDuration(tl) * fps) + (tl.frames.length ? 1 : 0);
  const index = names.map((name) => tl.names.indexOf(name));
  const tmp = new Float32Array(tl.names.length);
  const frames = Array.from({ length: n }, (_, i) => {
    sampleTimeline(tl, (tl.start ?? 0) + i / fps, tmp);
    return Float32Array.from(index, (k) => (k < 0 ? 0 : tmp[k]));
  });
  return { fps, names: [...names], frames, start: tl.start };
}

/**
 * A timeline that grows as a stream delivers chunks (a live method's `AsyncIterable`): frames are kept on the
 * stream's clock, up to `keepSeconds` of history, and sampled like any timeline.
 */
export class StreamTimeline implements ShapeTimeline {
  readonly fps: number;
  readonly names: ArkitName[];
  frames: Float32Array[] = [];
  start = 0;
  private readonly keep: number;

  constructor(names: readonly ArkitName[], fps: number, keepSeconds = 5) {
    this.names = [...names];
    this.fps = fps;
    this.keep = Math.max(2, Math.round(keepSeconds * fps));
  }

  /** Append a chunk (its frames continue this timeline at its `start`, or right after the last frame). */
  push(chunk: ShapeTimeline): void {
    if (chunk.frames.length === 0) return;
    const index = this.names.map((name) => chunk.names.indexOf(name));
    const frames = chunk.frames.map((f) => Float32Array.from(index, (k) => (k < 0 ? 0 : f[k])));
    if (this.frames.length === 0) this.start = chunk.start ?? 0;
    this.frames.push(...frames);
    const extra = this.frames.length - this.keep;
    if (extra > 0) {
      this.frames.splice(0, extra);
      this.start += extra / this.fps;
    }
  }

  /** Append one frame at clock time `t` (gaps are filled by holding the last frame). */
  pushFrame(t: number, frame: Float32Array): void {
    if (this.frames.length === 0) {
      this.push({ fps: this.fps, names: this.names, frames: [frame], start: t });
      return;
    }
    const due = Math.round((t - this.start) * this.fps) - (this.frames.length - 1);
    if (due <= 0) {
      this.frames[this.frames.length - 1] = frame;
      return;
    }
    const last = this.frames[this.frames.length - 1];
    const fill = Array.from({ length: Math.min(due - 1, this.keep) }, () => last);
    this.push({ fps: this.fps, names: this.names, frames: [...fill, frame] });
  }

  clear(): void {
    this.frames = [];
    this.start = 0;
  }
}

/** Drain a method's result into one timeline (an offline result as is; a stream's chunks concatenated). */
export async function collectTimeline(result: Promise<ShapeTimeline> | AsyncIterable<ShapeTimeline>): Promise<ShapeTimeline> {
  if (Symbol.asyncIterator in result) {
    let out: ShapeTimeline | null = null;
    for await (const chunk of result) {
      if (!out) out = { fps: chunk.fps, names: [...chunk.names], frames: [], start: chunk.start ?? 0 };
      out.frames.push(...chunk.frames);
    }
    return out ?? { fps: 30, names: [], frames: [] };
  }
  return result;
}
