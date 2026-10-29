/**
 * **Which ARKit names a web head keeps** (`scripts/web-head.mjs`): what the widget drives, and nothing else.
 *
 * - The performance layer: the five emotions' presets, the glances' eye shapes, the idle layer's blinks and eye
 *   saccades, the nod's smile (`webHead.test.ts` derives the same list from `performance/`).
 * - Lip sync: the default lip-sync profile's mouth shapes (talking-head-pipeline's `visemes.json` `names`; the
 *   server's `test_sync.py` checks the two match). A clip made with a profile that uses other shapes needs them kept:
 *   the export's `--keep` adds names (the server's project export passes its clips' timeline names).
 *
 * Self-contained (no imports), so the Node export script can load it as is.
 */

/** The default lip-sync profile's names (talking-head-pipeline/visemes.json `names`, in its order). */
export const LIPSYNC_NAMES = [
  "jawOpen", "mouthFunnel", "mouthPucker", "mouthStretchLeft", "mouthStretchRight", "mouthClose", "mouthPressLeft",
  "mouthPressRight", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight",
  "mouthRollLower", "tongueOut",
] as const;

/** The performance layer's names: emotions, glances, blinks, saccades, the nod. */
export const PERFORMANCE_NAMES = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "cheekSquintLeft",
  "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft",
  "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft",
  "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "mouthFrownLeft", "mouthFrownRight", "mouthPressLeft",
  "mouthPressRight", "mouthSmileLeft", "mouthSmileRight",
] as const;

/** Every ARKit name a web head keeps (a head without `tongueOut`, the ICT heads, simply can't show it). */
export const WEB_HEAD_NAMES: readonly string[] = [...new Set<string>([...PERFORMANCE_NAMES, ...LIPSYNC_NAMES])];
