import { describe, expect, it } from "vitest";

import { EXPRESSIVE_MOUTH, SPEAKING_KEEP, mixFrame } from "../lipsync/arkit";
import { BLINK, IdleLayer, rng } from "./idle";
import { NOD, Performer, type StudioSchedule } from "./performer";
import {
  DIRECTIONS, EMOTE_LEAD, EMOTIONS, EMOTION_PRESETS, GLANCE, HEAD_SHARE, INTENSITY, emotionWeights, envelope, lookWeights,
} from "./presets";

describe("the presets", () => {
  it("has the studio's five emotions plus neutral, its intensities and glance degrees", () => {
    expect([...EMOTIONS]).toEqual(["happy", "sad", "surprised", "interested", "concerned"]);
    expect(EMOTION_PRESETS.neutral).toEqual({});
    expect(INTENSITY).toEqual({ subtle: 0.5, clear: 1.0, strong: 1.4 });
    expect(DIRECTIONS).toHaveLength(6);
    expect(GLANCE["down-right"]).toEqual({ yaw: 15, pitch: -6 });
    expect(EMOTE_LEAD).toBe(0.3);
  });

  it("maps each emotion to the shapes the spec names", () => {
    expect(Object.keys(EMOTION_PRESETS.happy)).toEqual(expect.arrayContaining(["mouthSmileLeft", "cheekSquintLeft"]));
    expect(Object.keys(EMOTION_PRESETS.sad)).toEqual(expect.arrayContaining(["mouthFrownLeft", "browInnerUp"]));
    expect(Object.keys(EMOTION_PRESETS.surprised)).toEqual(expect.arrayContaining(["browInnerUp", "browOuterUpLeft", "eyeWideLeft"]));
    expect(Object.keys(EMOTION_PRESETS.interested)).toEqual(expect.arrayContaining(["browOuterUpLeft", "mouthSmileLeft"]));
    expect(Object.keys(EMOTION_PRESETS.concerned)).toEqual(expect.arrayContaining(["browInnerUp", "mouthPressLeft"]));
    // Emotions touch only the face and the expressive mouth shapes: lip sync owns the rest of the mouth.
    for (const preset of Object.values(EMOTION_PRESETS)) {
      for (const name of Object.keys(preset)) {
        expect(name.startsWith("mouth") || name.startsWith("jaw") ? EXPRESSIVE_MOUTH.includes(name as never) : true).toBe(true);
      }
    }
  });

  it("scales by strength and clamps", () => {
    expect(emotionWeights("happy", 0.5).mouthSmileLeft).toBeCloseTo(0.3);
    expect(emotionWeights("surprised", 1.4).browOuterUpLeft).toBeCloseTo(0.98);
    expect(emotionWeights("surprised", 3).browOuterUpLeft).toBe(1);
  });

  it("follows talk.py's envelope: smoothstep in, hold, smoothstep out", () => {
    expect(envelope(0, 1, 1, 0.5, 0.8)).toBe(0);
    expect(envelope(1.25, 1, 1, 0.5, 0.8)).toBeCloseTo(0.5);
    expect(envelope(2, 1, 1, 0.5, 0.8)).toBe(1);
    expect(envelope(2.9, 1, 1, 0.5, 0.8)).toBeCloseTo(0.5);
    expect(envelope(3.4, 1, 1, 0.5, 0.8)).toBe(0);
  });

  it("splits a glance between the head and the eyes, as the viewer sees it", () => {
    const right = lookWeights(18, 0);
    expect(right.pose.yaw).toBeCloseTo(18 * HEAD_SHARE);
    expect(right.weights.eyeLookOutLeft).toBeGreaterThan(0); // the viewer's right is the head's left
    expect(right.weights.eyeLookInRight).toBeGreaterThan(0);
    expect(right.weights.eyeLookOutRight).toBeUndefined();
    const upLeft = lookWeights(-15, 5);
    expect(upLeft.weights.eyeLookOutRight).toBeGreaterThan(0);
    expect(upLeft.weights.eyeLookUpLeft).toBeGreaterThan(0);
    expect(upLeft.pose.pitch).toBeGreaterThan(0);
  });
});

describe("the performer", () => {
  it("plays a studio schedule: the base mood, emotes and looks at their times", () => {
    const schedule: StudioSchedule = {
      emotion: "happy:0.35",
      emotes: [{ t: 1, emotion: "surprised", strength: 1.4, hold: 1 }],
      looks: [{ t: 3, yaw: -18, pitch: 0, hold: 1.2 }],
    };
    const p = new Performer();
    p.loadSchedule(schedule);
    const before = p.evaluate(0.5, { idle: false });
    expect(before.weights.mouthSmileLeft).toBeCloseTo(0.6 * 0.35);
    expect(before.weights.eyeWideLeft).toBeUndefined();
    expect(p.evaluate(2, { idle: false }).weights.eyeWideLeft).toBeCloseTo(0.6 * 1.4);
    const look = p.evaluate(3.8, { idle: false });
    expect(look.pose.yaw).toBeCloseTo(-18 * HEAD_SHARE);
    expect(look.weights.eyeLookOutRight).toBeGreaterThan(0);
    expect(p.evaluate(6, { idle: false }).pose.yaw).toBe(0);
    expect(p.cueTimes().map((c) => [c.t, c.kind])).toEqual([[1, "emote"], [3, "look"]]);
  });

  it("plays a live sentence: the emotion from the lead before it (not before now), held for the sentence", () => {
    let now = 10;
    const p = new Performer({ now: () => now });
    p.sentence(11, { emotion: "sad", intensity: "strong", glance: "down-left" }, 3);
    expect(p.isSpeaking(12)).toBe(true);
    expect(p.isSpeaking(14.5)).toBe(false);
    expect(p.cueTimes()[0]).toMatchObject({ t: 11 - EMOTE_LEAD, kind: "emote" });
    expect(p.evaluate(12.5, { idle: false }).weights.browInnerUp).toBeCloseTo(0.6 * 1.4);
    expect(p.evaluate(11.9, { idle: false }).pose.pitch).toBeLessThan(0); // the glance, a moment in
    // "now": a sentence that starts at once can't lead
    now = 20;
    p.sentence("now", { emotion: "happy", intensity: "clear", glance: null }, 1);
    expect(p.cueTimes().at(-1)).toMatchObject({ t: 20, kind: "emote" });
  });

  it("nods on 'I heard you'", () => {
    const p = new Performer({ now: () => 5 });
    p.nod();
    expect(p.evaluate(5 + NOD.duration / 2, { idle: false }).pose.pitch).toBeCloseTo(NOD.pitch);
    expect(p.evaluate(5 + NOD.duration + 0.1, { idle: false }).pose.pitch).toBe(0);
  });

  it("is mixed under lip sync: the smile scaled down while the mouth speaks, the pose kept", () => {
    const p = new Performer();
    p.setBaseMood("happy", 1);
    const perf = p.evaluate(1, { idle: false });
    expect(mixFrame({ jawOpen: 0.5 }, perf.weights).mouthSmileLeft).toBeCloseTo(0.6 * SPEAKING_KEEP);
    expect(mixFrame({}, perf.weights).mouthSmileLeft).toBeCloseTo(0.6);
    expect(mixFrame({}, perf.weights).cheekSquintLeft).toBeCloseTo(0.25);
  });

  it("ignores neutral and unknown glances, and starts over on reset", () => {
    const p = new Performer();
    p.emote(0, "neutral");
    p.look(0, "sideways" as never);
    expect(p.cueTimes()).toEqual([]);
    p.emote(0, "happy");
    p.reset();
    expect(p.cueTimes()).toEqual([]);
  });
});

describe("the idle layer", () => {
  it("is deterministic: the same seed gives the same frames however they're sampled", () => {
    const a = new IdleLayer(42);
    const b = new IdleLayer(42);
    const fine = Array.from({ length: 600 }, (_, i) => a.evaluate(i / 60)); // 10 s at 60 fps
    const coarse = Array.from({ length: 100 }, (_, i) => b.evaluate((i * 6) / 60)); // every 6th frame
    coarse.forEach((frame, i) => expect(frame).toEqual(fine[i * 6]));
    expect(new IdleLayer(43).blinkTimes(10)).not.toEqual(new IdleLayer(42).blinkTimes(10));
  });

  it("blinks every 3-5 s (now and then twice), and faster while talking", () => {
    const quiet = new IdleLayer(7).blinkTimes(60);
    const gaps = quiet.slice(1).map((t, i) => t - quiet[i]);
    expect(gaps.every((g) => (g >= BLINK.min - 1e-9 && g <= BLINK.max + 1e-9) || g < 0.5)).toBe(true);
    expect(quiet.length).toBeGreaterThanOrEqual(12);
    const talking = new IdleLayer(7, () => true).blinkTimes(60);
    expect(talking.length).toBeGreaterThan(quiet.length * 1.3);
  });

  it("closes both eyes during a blink and moves the head a little", () => {
    const idle = new IdleLayer(3);
    const first = idle.blinkTimes(10)[0];
    expect(idle.evaluate(first + BLINK.close).weights.eyeBlinkLeft).toBeCloseTo(1);
    expect(idle.evaluate(first + 1).weights.eyeBlinkLeft).toBe(0);
    const yaws = Array.from({ length: 200 }, (_, i) => idle.evaluate(i / 10).pose.yaw);
    expect(Math.max(...yaws.map(Math.abs))).toBeLessThan(3);
    expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(0.5);
  });

  it("has a seeded generator", () => {
    expect(Array.from({ length: 3 }, rng(1))).toEqual(Array.from({ length: 3 }, rng(1)));
  });
});

describe("the alive previews' loop", () => {
  it("goes through the five emotions, one per step, with a pause between", async () => {
    const { loopEmotion, LOOP_STEP } = await import("./loop");
    expect(loopEmotion(0.5, 0)).toBeNull();
    expect(loopEmotion(1.1, 0)).toBe("happy");
    expect(loopEmotion(1 + LOOP_STEP + 0.1, 0)).toBe("sad");
    expect(loopEmotion(1 + LOOP_STEP - 0.1, 0)).toBeNull();
    expect(loopEmotion(1 + 5 * LOOP_STEP + 0.1, 0)).toBe("happy");
  });
});
