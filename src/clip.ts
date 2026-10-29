/**
 * **The clip format, `talking-head-clip` version 1**: one studio segment as the widget plays it. A manifest (JSON) that
 * bundles what the studio already writes, unchanged, plus the audio beside it. Described in `docs/clip-format.md`;
 * talking-head-server writes it (`GET /api/v1/projects/{id}/segments/{sid}/clip/`, and the project export).
 *
 * ```json
 * {
 *   "format": "talking-head-clip",
 *   "version": 1,
 *   "id": "segment-01",
 *   "duration": 24.21,
 *   "audio": { "webm": "segment-01.webm", "mp3": "segment-01.mp3" },   // or one URL; relative to the manifest
 *   "timeline": { "format": "talking-head-timeline", "version": 1, ... },  // lipsync.json as is
 *   "schedule": { "emotion": "happy:0.2", "emotes": [...], "looks": [...] },  // schedule.json
 *   "words": [{ "word": "Studio", "start": 0, "end": 0.82 }, ...],
 *   "text": "Studio mode takes a minute…",
 *   "meta": { "project": "…", "segment": "…", "profile": "Default" }
 * }
 * ```
 *
 * Readers ignore unknown top-level fields; a new required field or a changed meaning is version 2.
 */
import { parseTimelineFile } from "./lipsync/format";
import type { ShapeTimeline } from "./lipsync/types";
import type { StudioSchedule } from "./performance/performer";

export const CLIP_FORMAT = "talking-head-clip";
export const CLIP_VERSION = 1;
/** The audio kinds a manifest may name, in the order the widget tries them. */
export const CLIP_AUDIO = ["webm", "mp3"] as const;
export type ClipAudioKind = (typeof CLIP_AUDIO)[number];

export interface ClipWord {
  word: string;
  start: number;
  end: number;
}

/** A clip manifest as it travels (the JSON above). */
export interface ClipFile {
  format: typeof CLIP_FORMAT;
  version: typeof CLIP_VERSION;
  id: string;
  duration: number;
  audio: string | Partial<Record<ClipAudioKind, string>>;
  timeline: unknown;
  schedule?: StudioSchedule | null;
  words?: ClipWord[];
  text?: string;
  meta?: Record<string, unknown>;
}

/** A clip read and checked, its audio URLs made absolute. */
export interface Clip {
  id: string;
  duration: number;
  audio: Partial<Record<ClipAudioKind, string>>;
  timeline: ShapeTimeline;
  schedule: StudioSchedule;
  words: ClipWord[];
  text: string;
  meta: Record<string, unknown>;
}

export class ClipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipFormatError";
  }
}

const EMPTY_SCHEDULE: StudioSchedule = { emotion: null, emotes: [], looks: [] };

/** The audio kind a URL names, by its extension (a single `audio` string). */
function audioKind(url: string): ClipAudioKind {
  return /\.mp3(\?|#|$)/i.test(url) ? "mp3" : "webm";
}

/**
 * Read a version 1 manifest (text or parsed JSON). `base` is the manifest's own URL: relative audio URLs resolve
 * against it. Throws `ClipFormatError` saying what's wrong.
 */
export function parseClip(input: string | unknown, base?: string): Clip {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      throw new ClipFormatError("not JSON");
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ClipFormatError("not a JSON object");
  const d = data as Record<string, unknown>;
  if (d.format !== CLIP_FORMAT) throw new ClipFormatError(`format must be "${CLIP_FORMAT}"`);
  if (d.version !== CLIP_VERSION) throw new ClipFormatError(`unsupported version ${String(d.version)}`);
  if (typeof d.id !== "string" || !d.id) throw new ClipFormatError("id must be a string");
  if (typeof d.duration !== "number" || !(d.duration >= 0)) throw new ClipFormatError("duration must be a number");

  const resolve = (url: string) => (base ? new URL(url, base).href : url);
  const audio: Clip["audio"] = {};
  if (typeof d.audio === "string" && d.audio) {
    audio[audioKind(d.audio)] = resolve(d.audio);
  } else if (d.audio && typeof d.audio === "object" && !Array.isArray(d.audio)) {
    for (const kind of CLIP_AUDIO) {
      const url = (d.audio as Record<string, unknown>)[kind];
      if (typeof url === "string" && url) audio[kind] = resolve(url);
    }
  }
  if (Object.keys(audio).length === 0) throw new ClipFormatError(`audio must name a ${CLIP_AUDIO.join(" or ")} file`);

  let timeline: ShapeTimeline;
  try {
    const { file: _file, ...tl } = parseTimelineFile(d.timeline);
    timeline = tl;
  } catch (cause) {
    throw new ClipFormatError(`timeline: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const schedule = d.schedule === undefined || d.schedule === null ? EMPTY_SCHEDULE : d.schedule;
  if (typeof schedule !== "object" || Array.isArray(schedule)) throw new ClipFormatError("schedule must be an object");
  const s = schedule as Partial<StudioSchedule>;
  if ((s.emotes !== undefined && !Array.isArray(s.emotes)) || (s.looks !== undefined && !Array.isArray(s.looks))) {
    throw new ClipFormatError("schedule's emotes and looks must be lists");
  }

  const words: ClipWord[] = [];
  if (d.words !== undefined) {
    if (!Array.isArray(d.words)) throw new ClipFormatError("words must be a list");
    d.words.forEach((w, i) => {
      const x = w as Partial<ClipWord> | null;
      if (!x || typeof x.word !== "string" || typeof x.start !== "number" || typeof x.end !== "number") {
        throw new ClipFormatError(`word ${i} needs word, start and end`);
      }
      words.push({ word: x.word, start: x.start, end: x.end });
    });
  }
  const text = typeof d.text === "string" ? d.text : words.map((w) => w.word).join(" ");
  const meta = d.meta && typeof d.meta === "object" && !Array.isArray(d.meta) ? (d.meta as Record<string, unknown>) : {};
  return { id: d.id, duration: d.duration, audio, timeline,
    schedule: { emotion: s.emotion ?? null, emotes: s.emotes ?? [], looks: s.looks ?? [] }, words, text, meta };
}

/** Fetch and read a manifest. */
export async function loadClip(url: string, init?: RequestInit): Promise<Clip> {
  const response = await fetch(url, init);
  if (!response.ok) throw new ClipFormatError(`${url}: HTTP ${response.status}`);
  return parseClip(await response.text(), response.url || url);
}
