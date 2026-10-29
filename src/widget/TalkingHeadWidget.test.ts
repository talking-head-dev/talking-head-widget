import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLIP_FORMAT } from "../clip";
import { optionsFromDataset } from "../iife";
import { TalkingHeadWidget } from "./TalkingHeadWidget";

const manifest = {
  format: CLIP_FORMAT, version: 1, id: "welcome", duration: 1.2, audio: { webm: "welcome.webm", mp3: "welcome.mp3" },
  timeline: { format: "talking-head-timeline", version: 1, fps: 10, names: ["jawOpen"], frames: [[0], [0.6], [0]] },
  schedule: { emotion: "happy:0.2", emotes: [], looks: [] },
  words: [{ word: "Hello", start: 0, end: 0.4 }, { word: "there.", start: 0.4, end: 0.9 }], text: "Hello there.",
};

let refuseSound = false;

beforeEach(() => {
  refuseSound = false;
  localStorage.clear();
  // jsdom: no WebGL (getContext would log "not implemented"), no media playback.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((t) => (t.includes("webm") ? "probably" : ""));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (refuseSound && !this.muted) return Promise.reject(new DOMException("no gesture", "NotAllowedError"));
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, url, text: async () => JSON.stringify(manifest) })));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const shadow = (w: TalkingHeadWidget) => w.element.shadowRoot!;
const q = <T extends Element = HTMLElement>(w: TalkingHeadWidget, sel: string) => shadow(w).querySelector(sel) as T;
const flush = () => new Promise((r) => setTimeout(r, 0));
const ready = (w: TalkingHeadWidget) => new Promise((resolve) => w.on("ready", resolve));

describe("the widget", () => {
  it("mounts in a shadow root in the corner, and shows a still without WebGL, logging nothing", async () => {
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const w = TalkingHeadWidget.mount({ head: "/head.glb", clips: { welcome: "/clips/welcome.clip.json" }, size: 120,
      load: "eager" });
    expect(document.body.querySelector("talking-head-widget")).toBe(w.element);
    expect(shadow(w).querySelector("style")!.textContent).toContain("bottom: 24px !important; right: 24px !important");
    expect(await ready(w)).toEqual({ mode: "still" });
    expect(q(w, ".view svg")).not.toBeNull();
    expect(q(w, ".hint").hidden).toBe(false); // "tap to hear"
    expect(w.stats).toMatchObject({ mode: "still", frames: 0, rendering: false, state: "idle" });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("plays the first clip on a click, with captions, and goes back to idle when it ends", async () => {
    const w = TalkingHeadWidget.mount({ clips: { welcome: "https://cdn.example.com/c/welcome.clip.json" }, load: "eager" });
    await ready(w);
    const events: string[] = [];
    w.on("play", (id) => events.push(`play ${id}`));
    w.on("ended", (id) => events.push(`ended ${id}`));
    q<HTMLButtonElement>(w, ".stage").click();
    await flush();
    await flush();
    const audio = (w as unknown as { audio: HTMLMediaElement }).audio;
    expect(audio.src).toBe("https://cdn.example.com/c/welcome.webm");
    expect(audio.muted).toBe(false);
    expect(w.stats.state).toBe("playing");
    expect(q(w, ".stage").getAttribute("aria-label")).toBe("Stop the assistant");
    expect(q(w, "#transcript").textContent).toBe("Hello there.");
    expect(q(w, ".caption").hidden).toBe(false);
    expect(q(w, ".caption").textContent).toBe("Hello there.");
    expect(q(w, ".caption .now").textContent).toBe("Hello");
    audio.dispatchEvent(new Event("ended"));
    expect(w.stats.state).toBe("idle");
    expect(q(w, ".caption").hidden).toBe(true);
    expect(events).toEqual(["play welcome", "ended welcome"]);
  });

  it("plays muted with autoplay \"muted\", and a click turns the sound on from the start", async () => {
    const w = TalkingHeadWidget.mount({ clips: { welcome: "/welcome.clip.json" }, autoplay: "muted", load: "eager" });
    await ready(w);
    await flush();
    await flush();
    const audio = (w as unknown as { audio: HTMLMediaElement }).audio;
    expect(w.stats).toMatchObject({ state: "playing", muted: true });
    expect(q(w, ".stage").getAttribute("aria-label")).toBe("Turn the assistant's sound on");
    q<HTMLButtonElement>(w, ".stage").click();
    expect(audio.muted).toBe(false);
    expect(audio.currentTime).toBe(0);
    expect(w.stats.state).toBe("playing");
  });

  it("makes no sound before a click: a refused play waits, showing the hint", async () => {
    refuseSound = true;
    const w = TalkingHeadWidget.mount({ clips: { welcome: "/welcome.clip.json" }, autoplay: false, load: "eager" });
    await ready(w);
    expect(q(w, ".hint").hidden).toBe(true); // autoplay false: no hint until the page tries
    await w.play();
    expect(w.stats.state).toBe("idle");
    expect(q(w, ".hint").hidden).toBe(false);
  });

  it("minimises to a launcher, remembers it, and stops", async () => {
    const w = TalkingHeadWidget.mount({ clips: { welcome: "/welcome.clip.json" }, load: "eager" });
    await ready(w);
    q<HTMLButtonElement>(w, ".close").click();
    expect(q(w, ".launcher").hidden).toBe(false);
    expect(q(w, ".stage-wrap").hidden).toBe(true);
    w.destroy();
    expect(document.body.querySelector("talking-head-widget")).toBeNull();
    const again = TalkingHeadWidget.mount({ clips: { welcome: "/welcome.clip.json" } });
    expect(q(again, ".launcher").hidden).toBe(false);
    q<HTMLButtonElement>(again, ".launcher").click();
    expect(q(again, ".stage-wrap").hidden).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it("reports a clip that won't load as an error event", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: false, status: 404, url, text: async () => "" })));
    const w = TalkingHeadWidget.mount({ clips: { welcome: "/missing.clip.json" }, load: "eager" });
    const errors: unknown[] = [];
    w.on("error", (e) => errors.push(e));
    await w.play();
    expect(String(errors[0])).toContain("HTTP 404");
    expect(w.stats.state).toBe("idle");
  });

  it("goes inline in a container, and refuses inline without one", () => {
    const box = document.createElement("section");
    document.body.append(box);
    const w = TalkingHeadWidget.mount({ position: "inline", container: box });
    expect(box.firstElementChild).toBe(w.element);
    expect(q(w, ".close")).toBeNull();
    expect(() => TalkingHeadWidget.mount({ position: "inline" })).toThrow("container");
  });
});

describe("the script tag's data attributes", () => {
  it("become options", () => {
    const s = document.createElement("script");
    Object.assign(s.dataset, { head: "/h.glb", clips: '{"a":"/a.json"}', autoplay: "false", size: "120",
      captions: "false", offset: '{"x":8,"y":8}', position: "bottom-left", load: "eager" });
    expect(optionsFromDataset(s.dataset)).toEqual({ head: "/h.glb", clips: { a: "/a.json" }, autoplay: false, size: 120,
      captions: false, offset: { x: 8, y: 8 }, position: "bottom-left", load: "eager" });
  });
});
