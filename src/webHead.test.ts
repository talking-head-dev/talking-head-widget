import { describe, expect, it } from "vitest";

import { resolveCategory } from "./blendshapes";
import { ARKIT_NAMES, isArkitName, type ArkitName } from "./lipsync/arkit";
import { IdleLayer } from "./performance/idle";
import { NOD } from "./performance/performer";
import { EMOTION_PRESETS, GLANCE, lookWeights } from "./performance/presets";
import { LIPSYNC_NAMES, PERFORMANCE_NAMES, WEB_HEAD_NAMES } from "./webHead";

describe("the names a web head keeps", () => {
  it("are every name the performance layer drives", () => {
    const driven = new Set<string>();
    for (const preset of Object.values(EMOTION_PRESETS)) Object.keys(preset).forEach((n) => driven.add(n));
    for (const { yaw, pitch } of [...Object.values(GLANCE), { yaw: 10, pitch: 10 }, { yaw: -10, pitch: -10 }]) {
      Object.keys(lookWeights(yaw, pitch).weights).forEach((n) => driven.add(n));
    }
    const idle = new IdleLayer(1);
    for (let t = 0; t < 60; t += 0.05) Object.keys(idle.evaluate(t).weights).forEach((n) => driven.add(n));
    expect(NOD.smile).toBeGreaterThan(0); // the nod adds mouthSmile*, which happy has
    expect([...PERFORMANCE_NAMES].sort()).toEqual([...driven].sort());
  });

  it("are ARKit names, with the lip-sync profile's, each once", () => {
    expect(WEB_HEAD_NAMES.every(isArkitName)).toBe(true);
    expect(new Set(WEB_HEAD_NAMES).size).toBe(WEB_HEAD_NAMES.length);
    expect(LIPSYNC_NAMES.every((n) => WEB_HEAD_NAMES.includes(n))).toBe(true);
    expect(WEB_HEAD_NAMES.length).toBeLessThan(ARKIT_NAMES.length);
    // Every kept name resolves to a GLB target name (what scripts/web-head.mjs keeps).
    for (const n of WEB_HEAD_NAMES) expect(resolveCategory(n as ArkitName, 0).length).toBeGreaterThan(0);
  });
});
