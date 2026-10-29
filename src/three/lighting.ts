import * as THREE from 'three';

/**
 * Scene lighting and backdrop for the head viewport.
 *
 * Kept separate from the renderer/model code because the rig and the material
 * repair are the two things most likely to be retuned independently.
 */

export interface StudioLighting {
  lights: THREE.Light[];
  background: THREE.Texture;
  exposure: number;
}

/**
 * Soft studio-gradient backdrop.
 *
 * A flat near-black scene.background (0x111111) made the head read as a
 * silhouette with no readable detail, so we build a light vertical ramp on a
 * canvas instead. The head is a mid-tone, so the lighter top / slightly darker
 * bottom keeps the silhouette separated from the backdrop.
 */
export function createStudioGradientTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;

  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0.0, '#f6f9fc'); // light ceiling
  gradient.addColorStop(0.5, '#dde5ee');
  gradient.addColorStop(1.0, '#bcc7d4'); // darker floor
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  // The canvas ramp is authored in sRGB; without this the gradient renders muddy/dark.
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Build the light rig and attach it to `scene`.
 *
 * The original rig stacked overlapping ambient/directional lights plus a red
 * PointLight directly above the skull, so the face was lit from one coloured
 * hot spot and everything else fell away to black. This is a calibrated
 * three-point setup instead:
 *   1. hemisphere fill - soft global bounce, keeps shadowed sides readable
 *   2. key light       - front upper right, defines the face
 *   3. fill light      - opposite the key, lifts the dark cheek and jaw shadow
 *   4. rim light       - behind, separates the head outline from the backdrop
 *
 * Intensities are tuned against ACES so a lit surface lands near ~0.85 display
 * value: bright and legible, but with the specular/detail range intact rather
 * than clipped.
 */
export function createStudioLighting(scene: THREE.Scene): StudioLighting {
  const lights: THREE.Light[] = [
    new THREE.HemisphereLight(0xffffff, 0x9aa6b5, 1.6),
    new THREE.AmbientLight(0xffffff, 0.35),
    new THREE.DirectionalLight(0xfff6ec, 2.2),
    new THREE.DirectionalLight(0xe6efff, 1.1),
    new THREE.DirectionalLight(0xffffff, 1.8),
  ];

  lights[2].position.set(3.5, 4.0, 5.0); // key
  lights[3].position.set(-4.0, 0.8, 3.5); // fill
  lights[4].position.set(-1.5, 3.0, -5.0); // rim

  lights.forEach((light) => scene.add(light));

  return { lights, background: createStudioGradientTexture(), exposure: 1 };
}
