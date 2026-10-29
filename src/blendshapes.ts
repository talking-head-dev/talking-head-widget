/**
 * MediaPipe blendshape name resolution.
 *
 * MediaPipe reports blendshape scores under its own category names
 * (`mouthSmileLeft`, `eyeWideRight`, ...). The GLB carries Blender-style
 * morph target names with `_L`/`_R` suffixes. The two schemes only coincide for
 * a handful of targets, so most of them need translating — and a miss is silent:
 * the runtime just writes nothing that frame, which is exactly why this file
 * lives on its own and is covered by docs/check-blendshape-coverage.mjs.
 */

/** MediaPipe category name -> this model's morph target name. */
const ALIASES: Record<string, string> = {
  eyeBlinkLeft: 'eyeBlink_L',
  eyeBlinkRight: 'eyeBlink_R',
  eyeLookDownLeft: 'eyeLookDown_L',
  eyeLookDownRight: 'eyeLookDown_R',
  eyeLookInLeft: 'eyeLookIn_L',
  eyeLookInRight: 'eyeLookIn_R',
  eyeLookOutLeft: 'eyeLookOut_L',
  eyeLookOutRight: 'eyeLookOut_R',
  eyeLookUpLeft: 'eyeLookUp_L',
  eyeLookUpRight: 'eyeLookUp_R',
  eyeSquintLeft: 'eyeSquint_L',
  eyeSquintRight: 'eyeSquint_R',
  eyeWideLeft: 'eyeWide_L',
  eyeWideRight: 'eyeWide_R',
  browDownLeft: 'browDown_L',
  browDownRight: 'browDown_R',
  browOuterUpLeft: 'browOuterUp_L',
  browOuterUpRight: 'browOuterUp_R',
  cheekSquintLeft: 'cheekSquint_L',
  cheekSquintRight: 'cheekSquint_R',
  jawForward: 'jawForward',
  jawLeft: 'jawLeft',
  jawRight: 'jawRight',
  mouthLeft: 'mouthLeft',
  mouthRight: 'mouthRight',
  mouthSmileLeft: 'mouthSmile_L',
  mouthSmileRight: 'mouthSmile_R',
  mouthFrownLeft: 'mouthFrown_L',
  mouthFrownRight: 'mouthFrown_R',
  mouthDimpleLeft: 'mouthDimple_L',
  mouthDimpleRight: 'mouthDimple_R',
  mouthLowerDownLeft: 'mouthLowerDown_L',
  mouthLowerDownRight: 'mouthLowerDown_R',
  mouthPressLeft: 'mouthPress_L',
  mouthPressRight: 'mouthPress_R',
  mouthStretchLeft: 'mouthStretch_L',
  mouthStretchRight: 'mouthStretch_R',
  mouthUpperUpLeft: 'mouthUpperUp_L',
  mouthUpperUpRight: 'mouthUpperUp_R',
  jawOpen: 'jawOpen',
  mouthClose: 'mouthClose',
  mouthFunnel: 'mouthFunnel',
  mouthPucker: 'mouthPucker',
  noseSneerLeft: 'noseSneer_L',
  noseSneerRight: 'noseSneer_R',
};

/**
 * Categories with no single expression file in ICT-FaceKit — both are shipped as an
 * `_L`/`_R` pair, so one tracked score drives two targets.
 *
 * Checked before ALIASES: both names used to appear there pointing at
 * non-existent single targets, which silently shadowed this table.
 */
const PAIRED_TARGETS: Record<string, [string, string]> = {
  browInnerUp: ['browInnerUp_L', 'browInnerUp_R'],
  cheekPuff: ['cheekPuff_L', 'cheekPuff_R'],
};

/** A single tracked value destined for one or more morph targets. */
export interface MorphAssignment {
  /** Morph target name as it appears in the GLB. */
  target: string;
  /** Value to write, normally 0..1. */
  value: number;
}

/**
 * Resolve one MediaPipe category to the morph target assignments it implies.
 *
 * Pure and model-agnostic on purpose: it returns names, never indices, so it can
 * be tested and audited without a GLB. Returns an empty array only when the
 * category is genuinely unknown — resolveTargets() filters that against the
 * model's dictionary separately, since "not in this model" is not an error.
 */
export function resolveCategory(categoryName: string, score: number): MorphAssignment[] {
  const pair = PAIRED_TARGETS[categoryName];
  if (pair) return pair.map((target) => ({ target, value: score }));

  const target = ALIASES[categoryName] ?? categoryName;
  return [{ target, value: score }];
}
