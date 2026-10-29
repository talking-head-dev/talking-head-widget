import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { resolveCategory } from "../blendshapes";
import { ARKIT_NAMES, ZERO_POSE, type Pose, type Weights } from "../lipsync/arkit";
import { createStudioLighting, type StudioLighting } from "./lighting";
import { repairModelMaterials } from "./materials";

/** What the head shows at a moment: ARKit weights (mixed: `lipsync/arkit.ts mixFrame`) and a head pose. */
export interface HeadFrame {
  weights: Weights;
  pose: Pose;
}

/** Called every animation frame with the time (seconds, `performance.now`): what to show. */
export type HeadDriver = (now: number) => HeadFrame;

export interface ViewportOptions {
  /** A transparent background instead of the studio gradient (the widget's corner). */
  transparent?: boolean;
  /** The highest device pixel ratio drawn at (default 2). */
  maxPixelRatio?: number;
  /** Start the render loop at once (default true); `start()` / `stop()` control it after. */
  autoStart?: boolean;
}

/**
 * **A talking head**: any of the 55-target head GLBs (the generic ICT head, an avatar's, a THS-7 head's) or their
 * web exports (`scripts/web-head.mjs`: fewer targets, quantized, meshopt-compressed), driven every animation frame
 * by a `HeadDriver` (lip sync + the performance layer), with the head turning on a pivot at the neck. Used by the
 * widget, and by the web app's Live screen, lip-sync routes and "alive" previews.
 *
 * Lifecycle: attach → load → setDriver … → dispose. `attach` throws where there is no WebGL (jsdom). The render loop
 * runs from `attach` (unless `autoStart: false`) until `stop()`; `maxFps` caps it (0: every animation frame).
 */
export class TalkingHeadViewport {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 1000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly lighting: StudioLighting;
  private readonly resizeObserver: ResizeObserver;
  private readonly container: HTMLElement;
  private readonly pivot = new THREE.Group();
  /** For each ARKit name, the (mesh, morph index) pairs it drives. */
  private targets = new Map<string, [THREE.Mesh, number][]>();
  private driver: HeadDriver = () => ({ weights: {}, pose: ZERO_POSE });
  private frame = 0;
  private lastDrawn = -Infinity;
  private disposed = false;
  /** The last frame shown (for tests in a browser: `window.__head`). */
  last: HeadFrame = { weights: {}, pose: ZERO_POSE };
  /** Frames drawn so far (the widget's tests read it to see the loop stop). */
  drawn = 0;
  /** At most this many frames a second (0: every animation frame). */
  maxFps = 0;
  /** Called after each frame is drawn. */
  onDraw: ((now: number) => void) | null = null;

  private constructor(container: HTMLElement, exposure: number, options: ViewportOptions) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: options.transparent ?? false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = exposure;
    container.appendChild(this.renderer.domElement);
    this.lighting = createStudioLighting(this.scene);
    if (!options.transparent) this.scene.background = this.lighting.background;
    this.scene.add(this.pivot);
    this.pivot.rotation.order = "YXZ";
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    if (options.autoStart ?? true) this.start();
  }

  /** `exposure`: the heads' flat skin washes out at 1 (HeadViewport uses 0.7); the textured generic head wants 1. */
  static attach(container: HTMLElement, exposure = 0.8, options: ViewportOptions = {}): TalkingHeadViewport {
    return new TalkingHeadViewport(container, exposure, options);
  }

  /** Load a head GLB, replacing the one shown, framed on the face with the pivot at the neck. */
  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    if (this.disposed) return;
    this.pivot.clear();
    const model = gltf.scene;
    repairModelMaterials(model);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // The pivot sits low in the head (the top of the neck), so a nod turns about the neck, not the nose.
    const neck = new THREE.Vector3(center.x, box.min.y + size.y * 0.25, center.z - size.z * 0.1);
    model.position.sub(neck);
    this.pivot.add(model);
    const face = new THREE.Vector3(0, center.y - neck.y + size.y * 0.08, 0);
    const dist = Math.max(size.x, size.y) * 2.3;
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    this.camera.position.set(0, face.y, dist);
    this.camera.lookAt(face);
    this.camera.updateProjectionMatrix();

    this.targets = new Map();
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
      for (const name of ARKIT_NAMES) {
        for (const { target } of resolveCategory(name, 0)) {
          const index = mesh.morphTargetDictionary[target];
          if (index === undefined) continue;
          const list = this.targets.get(name) ?? [];
          list.push([mesh, index]);
          this.targets.set(name, list);
        }
      }
    });
  }

  /** How many ARKit names this head can show (55-target GLBs: all 52; a web export: the ones it kept). */
  get drivableNames(): number {
    return this.targets.size;
  }

  setDriver(driver: HeadDriver): void {
    this.driver = driver;
  }

  /** Show one frame now (the loop does this every animation frame). */
  apply(frame: HeadFrame): void {
    this.last = frame;
    for (const [name, list] of this.targets) {
      const v = Math.min(1, Math.max(0, frame.weights[name as keyof Weights] ?? 0));
      for (const [mesh, index] of list) mesh.morphTargetInfluences![index] = v;
    }
    const d = THREE.MathUtils.degToRad;
    this.pivot.rotation.set(-d(frame.pose.pitch), d(frame.pose.yaw), -d(frame.pose.roll));
  }

  /** True while the render loop runs. */
  get running(): boolean {
    return this.frame !== 0;
  }

  /** Run the render loop (again). */
  start(): void {
    if (this.disposed || this.frame !== 0) return;
    this.frame = requestAnimationFrame(this.tick);
  }

  /** Stop the render loop: nothing is drawn until `start()` or `draw()`. */
  stop(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Drive and draw one frame now, loop or not (a still). */
  draw(now = performance.now() / 1000): void {
    if (this.disposed) return;
    try {
      this.apply(this.driver(now));
    } catch (cause) {
      console.error("head driver failed:", cause);
    }
    this.renderer.render(this.scene, this.camera);
    this.drawn += 1;
    this.onDraw?.(now);
  }

  private tick = (time: number): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    // A little slack, so a 30 fps cap on a 60 Hz display draws every other frame rather than drifting.
    if (this.maxFps > 0 && time - this.lastDrawn < 1000 / this.maxFps - 2) return;
    this.lastDrawn = time;
    this.draw(performance.now() / 1000);
  };

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (!this.running && this.drawn > 0) this.draw(); // a still stays drawn at the new size
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.renderer.domElement.remove();
    this.lighting.background.dispose();
    this.renderer.dispose();
    this.scene.clear();
  }
}
