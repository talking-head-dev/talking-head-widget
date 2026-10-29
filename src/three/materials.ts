import * as THREE from 'three';

/**
 * Material repair for the ICT-FaceKit head export.
 *
 * This is the fix that made the model visible at all, and it is the single most
 * model-specific piece of the app — if the GLB ever changes, this is where it
 * needs revisiting. See docs/Head_Base.glb.md §3.
 *
 * Head_Base*.glb was exported from Blender with materials modelled as glass:
 * 8 of the 12 carry KHR_materials_transmission at transmissionFactor = 1.
 * Three.js renders a transmissive surface by sampling the scene *behind* the
 * object, and there is nothing behind the head — so the transmitted light was
 * effectively the (previously near-black) background. No number of lights fixes
 * that; the surface returns almost nothing however brightly it is lit.
 */

/** Materials were exported with a very dark albedo; lift them or they read as voids. */
const DARK_ALBEDO_REPLACEMENT = 0x5a4a40;
/** Below this max channel value, an albedo counts as "too dark to read". */
const DARK_ALBEDO_THRESHOLD = 0.3;

export interface MaterialRepairReport {
  /** Number of meshes walked. */
  meshes: number;
  /** Materials that had transmission cleared. */
  transmissionCleared: number;
  /** Materials whose albedo was lifted. */
  albedosLifted: number;
}

/**
 * Normalise every material on `model` into an ordinary opaque PBR surface the
 * light rig can actually shade. Idempotent — safe to call more than once.
 *
 * Returns a small report rather than logging, so the caller decides what is
 * worth surfacing.
 */
export function repairModelMaterials(root: THREE.Object3D): MaterialRepairReport {
  const report: MaterialRepairReport = {
    meshes: 0,
    transmissionCleared: 0,
    albedosLifted: 0,
  };

  root.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) return;
    report.meshes += 1;

    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    materials.forEach((mat) => {
      if (!mat) return;

      // Cast to MeshPhysicalMaterial, not MeshStandardMaterial: `transmission`
      // is declared there, and it is the type a Blender glass export actually
      // deserialises into. Checking with `in` instead narrows the Material union
      // to `{}`, which drops the properties and fails to typecheck.
      const m = mat as THREE.MeshPhysicalMaterial;

      // --- the fix: stop treating the face as glass ---
      // GLTFLoader sets transparent = true for transmissive materials, so both
      // properties must be reset together or the mesh stays on the wrong render
      // path.
      if (m.transmission > 0) {
        m.transmission = 0;
        report.transmissionCleared += 1;
      }
      m.transparent = false;
      m.opacity = 1;

      // --- ordinary matte, non-metallic shading so the lights read ---
      // A metal lit only by analytic lights with no environment map reads black,
      // so metalness stays at zero regardless of what the export asked for.
      m.metalness = 0;
      m.roughness = 0.8;
      m.flatShading = false;
      m.envMapIntensity = 1;

      // Lift very dark albedos (the irises export as 0.2 gray, the lashes as
      // pure black) so they stay legible instead of collapsing into black voids.
      if (Math.max(m.color.r, m.color.g, m.color.b) < DARK_ALBEDO_THRESHOLD) {
        m.color = new THREE.Color(DARK_ALBEDO_REPLACEMENT);
        report.albedosLifted += 1;
      }

      // The GLB is already doubleSided; belt-and-braces in case the OBJ import
      // flipped any normals, which would otherwise render those faces black.
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    });

    // Start from a neutral expression; some exports ship non-zero base
    // influences, which would otherwise freeze a random expression onscreen.
    if (mesh.morphTargetInfluences) {
      mesh.morphTargetInfluences.fill(0);
    }
  });

  return report;
}
