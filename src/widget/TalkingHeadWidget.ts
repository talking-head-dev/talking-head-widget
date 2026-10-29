/**
 * **The widget**: a 3D talking head in a corner of any page, playing studio clips (`clip.ts`) with lip sync, the
 * schedule's emotes and glances, an idle layer and captions. Everything renders inside a Shadow DOM root on a
 * `<talking-head-widget>` element, so the page's CSS can't reach in and the widget's can't leak out.
 *
 * - **Loading:** this module is small; three.js and the head load (a dynamic import, its own chunk in the ESM build)
 *   when the widget first becomes visible (`load: "on-visible"`), when the browser is idle (`"idle"`) or at once
 *   (`"eager"`), and the first clip's manifest with them. Audio loads only when a clip plays.
 * - **Sound:** nothing plays with sound before the visitor clicks. `autoplay: "on-click"` (the default) waits for a
 *   click; `"muted"` plays the first clip muted with captions, and a click unmutes it from the start; `false` leaves
 *   playing to the page (`play()`), and the browser still refuses sound without a gesture.
 * - **Power:** the render loop stops while the widget is off-screen (`IntersectionObserver`), the tab is hidden or
 *   the widget is minimised, and draws at `idleFps` between clips. With `prefers-reduced-motion` or no WebGL it
 *   shows a still (the `poster`, or a silhouette; three.js isn't loaded) and clips play as sound and captions.
 */
import { CLIP_AUDIO, loadClip, type Clip } from "../clip";
import { mixFrame } from "../lipsync/arkit";
import { TimelinePlayer } from "../lipsync/player";
import { Performer } from "../performance/performer";
import type { TalkingHeadViewport } from "../three/TalkingHeadViewport";
import { captionAt, captionLines, type CaptionLine } from "./captions";
import { ICONS, STILL_SVG, widgetStyles, type Placement } from "./styles";

export type WidgetPosition = Placement["position"];
export type Autoplay = "on-click" | "muted" | false;
export type LoadWhen = "on-visible" | "idle" | "eager";

export interface WidgetLabels {
  region: string;
  play: string;
  stop: string;
  resume: string;
  unmute: string;
  hint: string;
  minimise: string;
  restore: string;
}

export const DEFAULT_LABELS: WidgetLabels = {
  region: "Talking assistant",
  play: "Play the assistant's message",
  stop: "Stop the assistant",
  resume: "Resume the assistant",
  unmute: "Turn the assistant's sound on",
  hint: "Tap to hear",
  minimise: "Hide the assistant",
  restore: "Show the assistant",
};

export interface WidgetOptions {
  /** The head GLB's URL (a web export: `scripts/web-head.mjs`). Without one, the widget shows its still. */
  head?: string;
  position?: WidgetPosition;
  /** Where the widget goes: `document.body` by default; required for `position: "inline"`. */
  container?: HTMLElement;
  /** The head's diameter in px (at most 112 on screens narrower than 480 px). */
  size?: number;
  /** From the corner, px. */
  offset?: { x: number; y: number };
  zIndex?: number;
  /** Clip manifests by id; the first is the one a click plays. */
  clips?: Record<string, string>;
  autoplay?: Autoplay;
  captions?: boolean;
  /** Blink, breathe and move a little between and under clips. */
  idle?: boolean;
  load?: LoadWhen;
  /** A still image of the head for reduced motion and no WebGL (a silhouette otherwise). */
  poster?: string;
  /** Tone-mapping exposure (the studio heads' flat skin: 0.8). */
  exposure?: number;
  /** Frames a second between clips (the idle motion is slow). */
  idleFps?: number;
  /** Show a button that minimises the widget (remembered in `localStorage`). */
  minimisable?: boolean;
  labels?: Partial<WidgetLabels>;
}

export type WidgetEvent = "ready" | "play" | "pause" | "ended" | "error";
type State = "idle" | "loading" | "playing" | "paused";
type Mode = "3d" | "still";

export interface WidgetStats {
  mode: Mode | null;
  /** Frames drawn so far. */
  frames: number;
  /** True while the render loop runs. */
  rendering: boolean;
  /** `performance.now()` when the head's first frame was drawn. */
  firstFrame: number | null;
  state: State;
  muted: boolean;
}

const STORAGE_KEY = "talking-head-widget:minimised";

/** True when this browser can make a WebGL context (checked without three.js, so a failure logs nothing). */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function readMinimised(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMinimised(value: boolean): void {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked (a sandboxed frame): not remembered
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}) => {
  const node = document.createElement(tag);
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

export class TalkingHeadWidget {
  /** Put a widget on the page. */
  static mount(options: WidgetOptions = {}): TalkingHeadWidget {
    return new TalkingHeadWidget(options);
  }

  readonly element: HTMLElement;
  private readonly options: Required<Omit<WidgetOptions, "head" | "container" | "poster" | "labels">> &
    Pick<WidgetOptions, "head" | "poster">;
  private readonly labels: WidgetLabels;
  private readonly root: ShadowRoot;
  private readonly ui: {
    wrap: HTMLDivElement; stage: HTMLButtonElement; view: HTMLDivElement; badge: HTMLSpanElement;
    caption: HTMLDivElement; hint: HTMLButtonElement; close: HTMLButtonElement | null; launcher: HTMLButtonElement;
    transcript: HTMLParagraphElement;
  };
  private readonly audio: HTMLMediaElement;
  private readonly performer = new Performer({ seed: 7 });
  private readonly listeners = new Map<WidgetEvent, Set<(detail: unknown) => void>>();
  private readonly clipCache = new Map<string, Promise<Clip>>();
  private readonly cleanups: (() => void)[] = [];
  private viewport: TalkingHeadViewport | null = null;
  private loading: Promise<void> | null = null;
  private mode: Mode | null = null;
  private state: State = "idle";
  private clip: Clip | null = null;
  private lip: TimelinePlayer | null = null;
  private lines: CaptionLine[] = [];
  private captionKey = "";
  private captionFrame = 0;
  private onScreen = false;
  private minimised: boolean;
  private played = false;
  /** bumped by every `play()` and every stop/pause during loading: an in-flight `play()` whose generation went
   * stale drops its clip instead of starting it. */
  private playSeq = 0;
  private firstFrame: number | null = null;
  private destroyed = false;

  private constructor(options: WidgetOptions) {
    const position = options.position ?? "bottom-right";
    if (position === "inline" && !options.container) throw new Error("position \"inline\" needs a container");
    this.options = {
      head: options.head, poster: options.poster, position, size: options.size ?? 160,
      offset: options.offset ?? { x: 24, y: 24 }, zIndex: options.zIndex ?? 2147483000, clips: options.clips ?? {},
      autoplay: options.autoplay ?? "on-click", captions: options.captions ?? true, idle: options.idle ?? true,
      load: options.load ?? "on-visible", exposure: options.exposure ?? 0.8, idleFps: options.idleFps ?? 30,
      minimisable: options.minimisable ?? position !== "inline",
    };
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
    this.minimised = this.options.minimisable && readMinimised();

    this.element = document.createElement("talking-head-widget");
    this.root = this.element.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = widgetStyles(this.options);
    const wrap = el("div", "root", { role: "region", "aria-label": this.labels.region, "data-state": "idle" });
    const caption = el("div", "caption", { "aria-hidden": "true", part: "caption" });
    caption.hidden = true;
    const row = el("div", "row");
    const hint = el("button", "hint", { type: "button" });
    hint.textContent = this.labels.hint;
    hint.hidden = true;
    const stageWrap = el("div", "stage-wrap");
    const stage = el("button", "stage", { type: "button", "aria-label": this.labels.play, part: "stage" });
    const view = el("div", "view");
    const badge = el("span", "badge");
    badge.innerHTML = ICONS.play;
    stage.append(view, badge);
    stageWrap.append(stage);
    let close: HTMLButtonElement | null = null;
    if (this.options.minimisable) {
      close = el("button", "close", { type: "button", "aria-label": this.labels.minimise });
      close.textContent = "×";
      stageWrap.append(close);
    }
    row.append(hint, stageWrap);
    const launcher = el("button", "launcher", { type: "button", "aria-label": this.labels.restore });
    launcher.innerHTML = ICONS.chat;
    const transcript = el("p", "sr", { id: "transcript" });
    stage.setAttribute("aria-describedby", "transcript");
    wrap.append(caption, row, launcher, transcript);
    this.root.append(style, wrap);
    this.ui = { wrap, stage, view, badge, caption, hint, close, launcher, transcript };

    // A <video>, not an <audio>: browsers allow muted autoplay ("muted") only for video elements. It plays the clip's
    // audio-only file and is never shown.
    const media = document.createElement("video");
    media.playsInline = true;
    media.preload = "none";
    this.audio = media;
    this.wireAudio();

    stage.addEventListener("click", () => void this.toggle());
    hint.addEventListener("click", () => void this.toggle());
    close?.addEventListener("click", () => this.setMinimised(true));
    launcher.addEventListener("click", () => this.setMinimised(false));
    this.applyMinimised();

    (options.container ?? document.body).append(this.element);
    this.watch();
  }

  // ---- public API --------------------------------------------------------------------------------------------------

  /** Play a clip (the first one by default). Without a click first, the browser may refuse sound: the widget then
   * waits for one, showing its hint. */
  async play(id?: string, { muted = false }: { muted?: boolean } = {}): Promise<void> {
    const clipId = id ?? Object.keys(this.options.clips)[0];
    if (!clipId) throw new Error("the widget has no clips");
    this.played = true;
    this.ui.hint.hidden = true;
    void this.ensureLoaded();
    const seq = ++this.playSeq;
    this.setState("loading");
    let clip: Clip;
    try {
      clip = await this.loadClip(clipId);
    } catch (cause) {
      if (this.destroyed || seq !== this.playSeq) return; // stopped while loading: no clip, no error
      this.setState("idle");
      this.fail(cause);
      return;
    }
    if (this.destroyed || seq !== this.playSeq) return; // stopped (or a newer play) while loading
    this.audio.pause();
    this.clip = clip;
    this.lines = this.options.captions ? captionLines(clip.words) : [];
    this.ui.transcript.textContent = clip.text;
    this.lip = new TimelinePlayer(clip.timeline, () => this.audio.currentTime);
    this.audio.src = this.pickAudio(clip);
    this.audio.muted = muted;
    try {
      await this.audio.play();
    } catch (cause) {
      if (this.destroyed || seq !== this.playSeq) return; // a pause interrupting play() also lands here
      this.clip = this.lip = null;
      this.setState("idle");
      if ((cause as DOMException)?.name === "NotAllowedError") {
        this.ui.hint.hidden = this.minimised; // sound needs a click first
        return;
      }
      this.fail(cause);
    }
  }

  pause(): void {
    if (this.state === "loading") {
      this.playSeq++; // nothing to pause yet: cancel the load instead of starting over it
      this.setState("idle");
    }
    this.audio.pause();
  }

  /** Stop the clip and go back to idling. */
  stop(): void {
    this.playSeq++; // an in-flight play() drops its clip when it lands
    this.audio.pause();
    this.endClip();
  }

  /** Listen to "ready" ({ mode }), "play" / "pause" / "ended" (the clip's id) or "error" (an Error). */
  on(event: WidgetEvent, listener: (detail: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener);
    this.listeners.set(event, set);
    return () => set.delete(listener);
  }

  /** Take the widget off the page and free everything. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.audio.pause();
    this.audio.removeAttribute("src");
    cancelAnimationFrame(this.captionFrame);
    this.cleanups.forEach((f) => f());
    this.viewport?.dispose();
    this.viewport = null;
    this.element.remove();
    this.listeners.clear();
  }

  get stats(): WidgetStats {
    return { mode: this.mode, frames: this.viewport?.drawn ?? 0, rendering: this.viewport?.running ?? false,
      firstFrame: this.firstFrame, state: this.state, muted: this.audio.muted };
  }

  /** The head's viewport once loaded (tests read its last frame). */
  get head(): TalkingHeadViewport | null {
    return this.viewport;
  }

  // ---- loading -----------------------------------------------------------------------------------------------------

  private watch(): void {
    const { load } = this.options;
    if (typeof IntersectionObserver === "function") {
      const io = new IntersectionObserver((entries) => {
        this.onScreen = entries.some((e) => e.isIntersecting);
        if (this.onScreen && load === "on-visible") void this.ensureLoaded();
        this.updateLoop();
      });
      io.observe(this.element);
      this.cleanups.push(() => io.disconnect());
    } else {
      this.onScreen = true;
      if (load === "on-visible") void this.ensureLoaded();
    }
    const onVisibility = () => this.updateLoop();
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
    if (load === "eager") void this.ensureLoaded();
    if (load === "idle") {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
      if (w.requestIdleCallback) w.requestIdleCallback(() => void this.ensureLoaded(), { timeout: 3000 });
      else setTimeout(() => void this.ensureLoaded(), 1500);
    }
  }

  /** Load the head (or show the still) and the first clip's manifest, once; never inside `mount()`, so "ready"
   * reaches listeners added right after it. */
  private ensureLoaded(): Promise<void> {
    this.loading ??= Promise.resolve().then(() => (this.destroyed ? undefined : this.load()));
    return this.loading;
  }

  private async load(): Promise<void> {
    const first = Object.keys(this.options.clips)[0];
    if (first) void this.loadClip(first).catch(() => undefined); // reported when it's played
    const still = !this.options.head || prefersReducedMotion() || !hasWebGL();
    if (!still) {
      try {
        const { TalkingHeadViewport } = await import("../three/TalkingHeadViewport");
        if (this.destroyed) return;
        const viewport = TalkingHeadViewport.attach(this.ui.view, this.options.exposure,
          { maxPixelRatio: 2, autoStart: false });
        this.viewport = viewport;
        viewport.setDriver((now) => this.frameAt(now));
        viewport.onDraw = () => {
          if (this.firstFrame !== null) return;
          this.firstFrame = performance.now();
          this.ready("3d");
        };
        await viewport.load(this.options.head!);
        if (this.destroyed) return;
        this.mode = "3d";
        viewport.draw();
        this.updateLoop();
        return;
      } catch (cause) {
        this.viewport?.dispose();
        this.viewport = null;
        this.fail(cause);
      }
    }
    this.showStill();
  }

  private showStill(): void {
    this.mode = "still";
    if (this.options.poster) {
      const img = el("img", "", { alt: "", src: this.options.poster });
      this.ui.view.replaceChildren(img);
    } else {
      this.ui.view.innerHTML = STILL_SVG;
    }
    this.ready("still");
  }

  private ready(mode: Mode): void {
    this.ui.wrap.dataset.mode = mode;
    this.emit("ready", { mode });
    if (this.options.autoplay === "muted" && !this.played && !this.minimised) void this.play(undefined, { muted: true });
    else if (this.options.autoplay === "on-click" && !this.played) this.ui.hint.hidden = this.minimised;
  }

  private loadClip(id: string): Promise<Clip> {
    const url = this.options.clips[id];
    if (!url) return Promise.reject(new Error(`no clip "${id}"`));
    let pending = this.clipCache.get(id);
    if (!pending) {
      pending = loadClip(new URL(url, document.baseURI).href);
      pending.catch(() => this.clipCache.delete(id));
      this.clipCache.set(id, pending);
    }
    return pending;
  }

  private pickAudio(clip: Clip): string {
    const probe = this.audio;
    const types: Record<(typeof CLIP_AUDIO)[number], string> = { webm: 'audio/webm; codecs="opus"', mp3: "audio/mpeg" };
    for (const kind of CLIP_AUDIO) {
      if (clip.audio[kind] && probe.canPlayType(types[kind])) return clip.audio[kind]!;
    }
    return (clip.audio.mp3 ?? clip.audio.webm)!;
  }

  // ---- playback ----------------------------------------------------------------------------------------------------

  private wireAudio(): void {
    const a = this.audio;
    a.addEventListener("playing", () => {
      if (!this.clip) return;
      this.anchorClip();
      this.setState("playing");
      this.emit("play", this.clip.id);
      this.tickCaptions();
    });
    a.addEventListener("seeked", () => this.anchorClip());
    a.addEventListener("pause", () => {
      if (!this.clip || a.ended) return;
      this.setState("paused");
      this.emit("pause", this.clip.id);
    });
    a.addEventListener("ended", () => {
      const id = this.clip?.id;
      this.endClip();
      if (id) this.emit("ended", id);
    });
    a.addEventListener("volumechange", () => this.renderBadge());
    a.addEventListener("error", () => {
      if (!this.clip) return;
      this.endClip();
      this.fail(new Error(`the clip's audio didn't load (${a.currentSrc || a.src})`));
    });
  }

  /** The performer runs on the widget's clock: put the clip's cues where its time 0 falls on that clock now. */
  private anchorClip(): void {
    if (!this.clip) return;
    const anchor = performance.now() / 1000 - this.audio.currentTime;
    this.performer.reset();
    this.performer.loadSchedule(this.clip.schedule, anchor);
    this.performer.speak(anchor, this.clip.duration);
  }

  private endClip(): void {
    this.clip = null;
    this.lip = null;
    this.performer.reset();
    this.audio.muted = false;
    this.setState("idle");
    this.showCaption(null);
  }

  private async toggle(): Promise<void> {
    void this.ensureLoaded();
    if (this.state === "playing" && this.audio.muted) {
      // "muted" autoplay: the click turns the sound on, from the start
      this.audio.muted = false;
      this.audio.currentTime = 0;
      return;
    }
    if (this.state === "playing" || this.state === "loading") return this.stop();
    if (this.state === "paused" && this.clip) {
      await this.audio.play().catch((cause) => this.fail(cause));
      return;
    }
    await this.play();
  }

  /** What the head shows at `now`: the performance layer under the clip's lip sync. */
  private frameAt(now: number) {
    const perf = this.performer.evaluate(now, { idle: this.options.idle });
    const lip = this.lip && !this.audio.paused ? this.lip.sample() : {};
    return { weights: mixFrame(lip, perf.weights), pose: perf.pose };
  }

  private tickCaptions = (): void => {
    cancelAnimationFrame(this.captionFrame);
    if (this.state !== "playing") return;
    const at = captionAt(this.lines, this.audio.currentTime);
    this.showCaption(at);
    this.captionFrame = requestAnimationFrame(this.tickCaptions);
  };

  private showCaption(at: ReturnType<typeof captionAt>): void {
    const key = at ? `${at.line.start}:${at.word}` : "";
    if (key === this.captionKey) return;
    this.captionKey = key;
    const box = this.ui.caption;
    if (!at || this.minimised) {
      box.hidden = true;
      return;
    }
    box.replaceChildren(...at.line.words.flatMap((w, i) => {
      const span = document.createElement("span");
      span.textContent = w.word;
      if (i === at.word) span.className = "now";
      return i ? [document.createTextNode(" "), span] : [span];
    }));
    box.hidden = false;
  }

  // ---- state, loop, UI ---------------------------------------------------------------------------------------------

  private setState(state: State): void {
    this.state = state;
    this.ui.wrap.dataset.state = state;
    this.renderBadge();
    this.updateLoop();
  }

  private renderBadge(): void {
    const { badge, stage } = this.ui;
    const muted = this.state === "playing" && this.audio.muted;
    const [icon, label] = muted ? [ICONS.muted, this.labels.unmute]
      : this.state === "playing" || this.state === "loading" ? [ICONS.stop, this.labels.stop]
      : this.state === "paused" ? [ICONS.play, this.labels.resume] : [ICONS.play, this.labels.play];
    if (badge.innerHTML !== icon) badge.innerHTML = icon;
    stage.setAttribute("aria-label", label);
  }

  /** Run the render loop only while it shows something that moves. */
  private updateLoop(): void {
    const v = this.viewport;
    if (!v || this.mode !== "3d") return;
    const still = prefersReducedMotion();
    const show = this.onScreen && document.visibilityState !== "hidden" && !this.minimised;
    v.maxFps = this.state === "playing" ? 0 : this.options.idleFps;
    if (show && !still && (this.options.idle || this.state === "playing")) v.start();
    else v.stop();
  }

  private setMinimised(value: boolean): void {
    this.minimised = value;
    writeMinimised(value);
    if (value) this.stop();
    this.applyMinimised();
    this.updateLoop();
    (value ? this.ui.launcher : this.ui.stage).focus();
  }

  private applyMinimised(): void {
    const m = this.minimised;
    this.ui.wrap.dataset.minimised = String(m);
    this.ui.launcher.hidden = !m;
    (this.ui.stage.parentElement as HTMLElement).hidden = m;
    this.ui.hint.hidden = m || this.played || this.options.autoplay !== "on-click" || this.mode === null;
    if (m) this.ui.caption.hidden = true;
  }

  private emit(event: WidgetEvent, detail: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      try {
        listener(detail);
      } catch (cause) {
        console.warn("talking-head-widget: a listener failed:", cause);
      }
    }
  }

  private fail(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    if ((this.listeners.get("error")?.size ?? 0) === 0) console.warn("talking-head-widget:", error.message);
    this.emit("error", error);
  }
}
