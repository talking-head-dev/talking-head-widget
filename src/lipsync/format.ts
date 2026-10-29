/**
 * **The timeline JSON format, version 1**: how a `ShapeTimeline` travels between the server, the pipeline (H2 will
 * write it next to a studio segment's audio), files and this app (the dev route loads it; live mode can receive it).
 * Described in `docs/lipsync/timeline-format.md`.
 *
 * ```json
 * {
 *   "format": "talking-head-timeline",
 *   "version": 1,
 *   "fps": 30,
 *   "names": ["jawOpen", "mouthFunnel", ...],     // ARKit names (any subset, any order)
 *   "frames": [[0.0, 0.1, ...], ...],              // one row per frame, one value (0..1) per name
 *   "start": 0,                                    // optional: seconds of frame 0 on the audio's clock
 *   "method": "webcam",                            // optional: which method made it
 *   "audio": "speech.wav",                         // optional: the audio it goes with
 *   "meta": {}                                     // optional: anything else, kept as is
 * }
 * ```
 *
 * Readers ignore unknown top-level fields; a new required field or a changed meaning is version 2.
 */
import { isArkitName, type ArkitName } from "./arkit";
import type { LipSyncMethodId, ShapeTimeline } from "./types";

export const TIMELINE_FORMAT = "talking-head-timeline";
export const TIMELINE_VERSION = 1;

export interface TimelineFile {
  format: typeof TIMELINE_FORMAT;
  version: typeof TIMELINE_VERSION;
  fps: number;
  names: ArkitName[];
  frames: number[][];
  start?: number;
  method?: LipSyncMethodId;
  audio?: string;
  meta?: Record<string, unknown>;
}

export class TimelineFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimelineFormatError";
  }
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** A timeline as a version 1 file (values rounded to 3 decimals). */
export function toTimelineFile(
  tl: ShapeTimeline,
  extra: { method?: LipSyncMethodId; audio?: string; meta?: Record<string, unknown> } = {},
): TimelineFile {
  return {
    format: TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    fps: tl.fps,
    names: [...tl.names],
    frames: tl.frames.map((f) => Array.from(f, (v) => round(v, 3))),
    ...(tl.start ? { start: tl.start } : {}),
    ...extra,
  };
}

/** Read a version 1 file (text or parsed JSON); throws `TimelineFormatError` saying what's wrong. */
export function parseTimelineFile(input: string | unknown): ShapeTimeline & { file: TimelineFile } {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new TimelineFormatError("not JSON");
    }
  }
  if (!data || typeof data !== "object") throw new TimelineFormatError("not a JSON object");
  const d = data as Record<string, unknown>;
  if (d.format !== TIMELINE_FORMAT) throw new TimelineFormatError(`format must be "${TIMELINE_FORMAT}"`);
  if (d.version !== TIMELINE_VERSION) throw new TimelineFormatError(`unsupported version ${String(d.version)}`);
  if (typeof d.fps !== "number" || !(d.fps > 0) || d.fps > 1000) throw new TimelineFormatError("fps must be 1-1000");
  if (!Array.isArray(d.names) || d.names.length === 0) throw new TimelineFormatError("names must be a list");
  const bad = d.names.find((n) => typeof n !== "string" || !isArkitName(n));
  if (bad !== undefined) throw new TimelineFormatError(`unknown name ${JSON.stringify(bad)}`);
  if (new Set(d.names).size !== d.names.length) throw new TimelineFormatError("names repeat");
  if (!Array.isArray(d.frames)) throw new TimelineFormatError("frames must be a list");
  const width = d.names.length;
  const frames = d.frames.map((row, i) => {
    if (!Array.isArray(row) || row.length !== width || row.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      throw new TimelineFormatError(`frame ${i} must be ${width} numbers`);
    }
    return Float32Array.from(row as number[]);
  });
  if (d.start !== undefined && typeof d.start !== "number") throw new TimelineFormatError("start must be a number");
  return { fps: d.fps, names: d.names as ArkitName[], frames, start: (d.start as number | undefined) ?? 0,
    file: d as unknown as TimelineFile };
}
