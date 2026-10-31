import { describe, expect, it } from "vitest";

import { ARKIT_NAMES, EXPRESSIVE_MOUTH, FACE_NAMES, MOUTH_NAMES, SPEAKING_KEEP, addPose, mixFrame, shapeValue } from "./arkit";
import { TIMELINE_FORMAT, TimelineFormatError, parseTimelineFile, toTimelineFile } from "./format";
import { ManualClock, TimelinePlayer } from "./player";
import { StreamTimeline, collectTimeline, emptyTimeline, frameWeights, resampleTimeline, sampleTimeline, timelineDuration,
  type ShapeTimeline } from "./types";

const tl = (fps: number, values: number[]): ShapeTimeline => ({
  fps, names: ["jawOpen"], frames: values.map((v) => Float32Array.of(v)),
});

describe("ARKit names and the mixing rules", () => {
  it("never shows mouthClose above jawOpen, which would push the lip up to the nose on a closed jaw", () => {
    expect(shapeValue({ mouthClose: 0.95 }, "mouthClose")).toBe(0);
    expect(shapeValue({ mouthClose: 0.95, jawOpen: 0.2 }, "mouthClose")).toBeCloseTo(0.2);
    expect(shapeValue({ mouthClose: 0.1, jawOpen: 0.2 }, "mouthClose")).toBeCloseTo(0.1);
    expect(shapeValue({ jawOpen: 1.4 }, "jawOpen")).toBe(1);
    expect(shapeValue({ mouthPressLeft: -0.2 }, "mouthPressLeft")).toBe(0);
  });

  it("has the 52 ARKit names, split into mouth and face", () => {
    expect(ARKIT_NAMES).toHaveLength(52);
    expect(new Set(ARKIT_NAMES).size).toBe(52);
    expect(MOUTH_NAMES.length + FACE_NAMES.length).toBe(52);
    expect(MOUTH_NAMES).toContain("jawOpen");
    expect(MOUTH_NAMES).toContain("tongueOut");
    expect(FACE_NAMES).toContain("browInnerUp");
    expect(FACE_NAMES).toContain("eyeBlinkLeft");
    expect(EXPRESSIVE_MOUTH.every((n) => MOUTH_NAMES.includes(n))).toBe(true);
  });

  it("lets lip sync own the mouth: the performance layer adds only expressive shapes there", () => {
    const out = mixFrame({ jawOpen: 0.2 }, { jawOpen: 0.9, mouthFunnel: 0.5, browInnerUp: 0.4 }, 0);
    expect(out.jawOpen).toBeCloseTo(0.2);
    expect(out.mouthFunnel).toBeUndefined();
    expect(out.browInnerUp).toBeCloseTo(0.4);
  });

  it("scales the smile down while the mouth speaks", () => {
    expect(mixFrame({}, { mouthSmileLeft: 0.8 }, 0).mouthSmileLeft).toBeCloseTo(0.8);
    expect(mixFrame({}, { mouthSmileLeft: 0.8 }, 1).mouthSmileLeft).toBeCloseTo(0.8 * SPEAKING_KEEP);
    // read from the lip frame's jaw when not given
    expect(mixFrame({ jawOpen: 0.35 }, { mouthFrownRight: 0.5 }).mouthFrownRight).toBeCloseTo(0.5 * SPEAKING_KEEP);
  });

  it("adds the lip layer's face values (the webcam tracks brows) and clamps to 0..1", () => {
    const out = mixFrame({ browInnerUp: 0.7, jawOpen: 1.4 }, { browInnerUp: 0.6 });
    expect(out.browInnerUp).toBe(1);
    expect(out.jawOpen).toBe(1);
  });

  it("adds head poses", () => {
    expect(addPose({ yaw: 10, pitch: 1, roll: 0 }, { yaw: -3, pitch: 2, roll: 1 })).toEqual({ yaw: 7, pitch: 3, roll: 1 });
  });
});

describe("timelines", () => {
  it("interpolates between frames and holds the ends", () => {
    const t = tl(10, [0, 1, 0.5]);
    expect(timelineDuration(t)).toBeCloseTo(0.2);
    expect(sampleTimeline(t, 0.05)[0]).toBeCloseTo(0.5);
    expect(sampleTimeline(t, 0.15)[0]).toBeCloseTo(0.75);
    expect(sampleTimeline(t, -1)[0]).toBe(0);
    expect(sampleTimeline(t, 9)[0]).toBeCloseTo(0.5);
    expect(sampleTimeline({ ...t, start: 1 }, 1.05)[0]).toBeCloseTo(0.5);
    expect(sampleTimeline(emptyTimeline(["jawOpen"], 30), 0)[0]).toBe(0);
  });

  it("resamples to another rate and other names", () => {
    const r = resampleTimeline(tl(10, [0, 1]), 100, ["jawOpen", "mouthFunnel"]);
    expect(r.frames).toHaveLength(11);
    expect(r.frames[5][0]).toBeCloseTo(0.5);
    expect(r.frames[5][1]).toBe(0);
  });

  it("converts frames and weights", () => {
    expect(frameWeights(["jawOpen", "mouthFunnel"], [0.3, 0])).toEqual({ jawOpen: expect.closeTo(0.3) });
  });

  it("grows a stream timeline from chunks and frames, keeping a window of history", () => {
    const s = new StreamTimeline(["jawOpen"], 10, 0.5);
    s.push({ fps: 10, names: ["jawOpen"], frames: [Float32Array.of(0.1)], start: 2 });
    s.pushFrame(2.3, Float32Array.of(0.4)); // two frames missed: held
    expect(s.frames.map((f) => Number(f[0].toFixed(3)))).toEqual([0.1, 0.1, 0.1, 0.4]);
    expect(sampleTimeline(s, 2.3)[0]).toBeCloseTo(0.4);
    for (let i = 4; i < 12; i++) s.pushFrame(2 + i / 10, Float32Array.of(i / 10));
    expect(s.frames).toHaveLength(5);
    expect(s.start).toBeCloseTo(2.7);
    expect(sampleTimeline(s, 3.1)[0]).toBeCloseTo(1.1);
  });

  it("collects a streamed result into one timeline", async () => {
    async function* chunks() {
      yield { fps: 10, names: ["jawOpen" as const], frames: [Float32Array.of(0.1)], start: 1 };
      yield { fps: 10, names: ["jawOpen" as const], frames: [Float32Array.of(0.2)], start: 1.1 };
    }
    const all = await collectTimeline(chunks());
    expect(all.frames.map((f) => f[0])).toEqual([expect.closeTo(0.1), expect.closeTo(0.2)]);
    expect(all.start).toBe(1);
  });
});

describe("the timeline JSON format", () => {
  it("round-trips a timeline", () => {
    const file = toTimelineFile({ ...tl(30, [0.12345, 0.5]), start: 0.5 }, { method: "webcam", audio: "a.wav" });
    expect(file).toMatchObject({ format: TIMELINE_FORMAT, version: 1, fps: 30, names: ["jawOpen"], frames: [[0.123], [0.5]],
      start: 0.5, method: "webcam", audio: "a.wav" });
    const back = parseTimelineFile(JSON.stringify(file));
    expect(back.fps).toBe(30);
    expect(back.start).toBe(0.5);
    expect(back.frames[1][0]).toBeCloseTo(0.5);
    expect(back.file.method).toBe("webcam");
  });

  it.each([
    ["{", "not JSON"],
    ["[]", "format must be"],
    [JSON.stringify({ format: TIMELINE_FORMAT, version: 2 }), "unsupported version 2"],
    [JSON.stringify({ format: TIMELINE_FORMAT, version: 1, fps: 0, names: ["jawOpen"], frames: [] }), "fps"],
    [JSON.stringify({ format: TIMELINE_FORMAT, version: 1, fps: 30, names: ["jaw"], frames: [] }), 'unknown name "jaw"'],
    [JSON.stringify({ format: TIMELINE_FORMAT, version: 1, fps: 30, names: ["jawOpen", "jawOpen"], frames: [] }), "repeat"],
    [JSON.stringify({ format: TIMELINE_FORMAT, version: 1, fps: 30, names: ["jawOpen"], frames: [[1, 2]] }), "frame 0"],
  ])("refuses %s", (text, message) => {
    expect(() => parseTimelineFile(text)).toThrow(TimelineFormatError);
    expect(() => parseTimelineFile(text)).toThrow(message);
  });
});

describe("the timeline player", () => {
  it("plays against a clock, interpolating, and rests outside the timeline", () => {
    let now = 0;
    const player = new TimelinePlayer(tl(30, [0, 0.3, 0.6, 0.9]), () => now);
    now = 1 / 60; // halfway between frame 0 and 1: a 60 fps display from a 30 fps timeline
    expect(player.sample().jawOpen).toBeCloseTo(0.15);
    now = 2.5 / 30;
    expect(player.sample().jawOpen).toBeCloseTo(0.75);
    expect(player.playing()).toBe(true);
    now = 1;
    expect(player.playing()).toBe(false);
    expect(player.sample()).toEqual({});
    expect(player.sampleAt(1).jawOpen).toBeCloseTo(0.9);
  });

  it("applies an offset, and a live timeline keeps its newest frame", () => {
    let now = 5;
    const player = new TimelinePlayer(tl(10, [0.2, 0.4]), () => now, { offset: -5 });
    expect(player.sample().jawOpen).toBeCloseTo(0.2);
    now = 9;
    expect(new TimelinePlayer(tl(10, [0.2, 0.4]), () => now, { live: true }).sample().jawOpen).toBeCloseTo(0.4);
  });

  it("has a manual clock with pause, resume and seek", () => {
    let wall = 10;
    const clock = new ManualClock(() => wall);
    wall = 11;
    expect(clock.time()).toBe(1);
    clock.pause();
    wall = 15;
    expect(clock.time()).toBe(1);
    clock.resume();
    wall = 16;
    expect(clock.time()).toBe(2);
    clock.seek(0.5);
    expect(clock.time()).toBe(0.5);
  });
});
