import { describe, expect, it } from "vitest";

import { CLIP_FORMAT, ClipFormatError, parseClip, type ClipFile } from "./clip";

const timeline = { format: "talking-head-timeline", version: 1, fps: 10, names: ["jawOpen"], frames: [[0], [0.5], [0]] };
const manifest = (extra: Partial<ClipFile> = {}): ClipFile => ({
  format: CLIP_FORMAT, version: 1, id: "segment-01", duration: 0.2, audio: { webm: "segment-01.webm", mp3: "segment-01.mp3" },
  timeline, schedule: { emotion: "happy:0.2", emotes: [{ t: 0.1, emotion: "surprised", strength: 1, hold: 0.5 }], looks: [] },
  words: [{ word: "Hi.", start: 0, end: 0.2 }], text: "Hi.", meta: { project: "p" }, ...extra,
});

describe("the clip format", () => {
  it("reads a manifest, its audio made absolute against the manifest's URL", () => {
    const clip = parseClip(JSON.stringify(manifest()), "https://cdn.example.com/clips/segment-01.clip.json");
    expect(clip.id).toBe("segment-01");
    expect(clip.audio).toEqual({ webm: "https://cdn.example.com/clips/segment-01.webm",
      mp3: "https://cdn.example.com/clips/segment-01.mp3" });
    expect(clip.timeline.frames).toHaveLength(3);
    expect(clip.timeline.names).toEqual(["jawOpen"]);
    expect(clip.schedule.emotion).toBe("happy:0.2");
    expect(clip.schedule.emotes[0].emotion).toBe("surprised");
    expect(clip.words[0]).toEqual({ word: "Hi.", start: 0, end: 0.2 });
    expect(clip.meta).toEqual({ project: "p" });
  });

  it("takes one audio URL (its kind from the extension), no schedule, no words, and ignores unknown fields", () => {
    const clip = parseClip({ ...manifest({ audio: "a.mp3", schedule: undefined, words: undefined, text: undefined }),
      future: true });
    expect(clip.audio).toEqual({ mp3: "a.mp3" });
    expect(clip.schedule).toEqual({ emotion: null, emotes: [], looks: [] });
    expect(clip.words).toEqual([]);
    expect(clip.text).toBe("");
  });

  it.each([
    ["{", "not JSON"],
    ["[]", "not a JSON object"],
    [JSON.stringify({ ...manifest(), format: "x" }), "format must be"],
    [JSON.stringify({ ...manifest(), version: 2 }), "unsupported version 2"],
    [JSON.stringify({ ...manifest(), id: "" }), "id must be"],
    [JSON.stringify({ ...manifest(), duration: "1" }), "duration"],
    [JSON.stringify({ ...manifest(), audio: { ogg: "a.ogg" } }), "audio must name"],
    [JSON.stringify({ ...manifest(), timeline: { ...timeline, version: 9 } }), "timeline: unsupported version 9"],
    [JSON.stringify({ ...manifest(), schedule: { emotes: {} } }), "emotes and looks"],
    [JSON.stringify({ ...manifest(), words: [{ word: "x" }] }), "word 0"],
  ])("refuses %s", (text, message) => {
    expect(() => parseClip(text)).toThrow(ClipFormatError);
    expect(() => parseClip(text)).toThrow(message);
  });
});
