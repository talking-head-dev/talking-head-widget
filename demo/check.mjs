#!/usr/bin/env node
/**
 * **The widget's checks in a real browser** (headless Chromium through Playwright), against `node demo/serve.mjs`
 * with a studio project export unzipped in demo/content/ (head.glb + clips/). Prints one JSON report and writes
 * screenshots to --out.
 *
 *   PLAYWRIGHT=/path/to/node_modules/playwright node demo/check.mjs [--base http://localhost:5790/] [--out /tmp/widget-check]
 *       [--heads original.glb=web.glb,…] [--clip segment-04] [--gl swiftshader|gpu]
 *
 * Playwright isn't a dependency (as in the web app: `require` it from wherever it's installed). What it checks:
 * - heads: each original GLB and its web export at 160 px, neutral / jawOpen / a smile / a blink (screenshots and the
 *   mean pixel difference);
 * - both builds (script-tag.html, esm.html): no sound before a click; a click plays the clip with lip sync, the
 *   schedule's emotes and looks at their times, captions; the last frame after it ends; "muted" autoplay; the hostile
 *   stylesheet changes nothing; rendering stops while hidden and off-screen; reduced motion and no WebGL show a still
 *   and log no errors;
 * - the costs: gzipped sizes, the time to the first frame, the CPU while idling and while speaking.
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import sharp from "sharp";

const { values } = parseArgs({ options: {
  base: { type: "string" }, out: { type: "string" }, heads: { type: "string" }, clip: { type: "string" },
  gl: { type: "string" },
} });
const BASE = values.base ?? "http://localhost:5790/";
const CONTENT = BASE.replace(/:(\d+)\/?$/, (_, p) => `:${Number(p) + 1}/`);
const OUT = resolve(values.out ?? "/tmp/widget-check");
const CLIP = values.clip ?? "segment-04";
const root = resolve(import.meta.dirname, "..");
mkdirSync(OUT, { recursive: true });
if (!process.env.PLAYWRIGHT) throw new Error("set PLAYWRIGHT to a playwright package folder");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT);

const report = { base: BASE, content: CONTENT, clip: CLIP };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).byteLength;

async function diff(a, b) {
  const [x, y] = await Promise.all([a, b].map((f) => sharp(f).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return Number((sum / x.length).toFixed(2)); // mean absolute difference per channel, 0-255
}

/** Console errors and page errors, collected per page. */
function watch(page, errors) {
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
}

// --gl swiftshader (the default: software WebGL, runs anywhere, but its CPU numbers are the rasterizer's) or gpu (this
// machine's GPU through ANGLE's GL backend: the CPU numbers a visitor's laptop would see).
const GL = values.gl === "gpu" ? ["--use-gl=angle", "--use-angle=gl", "--enable-gpu", "--ignore-gpu-blocklist"]
  : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
report.gl = values.gl ?? "swiftshader";
// Chrome's desktop autoplay policy: sound needs the visitor's gesture, muted video may autoplay.
const browser = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required", ...GL] });

// ---- 1. the heads: original vs web export ----------------------------------------------------------------------------
const POSES = { neutral: {}, jawOpen: { jawOpen: 0.8 }, smile: { mouthSmileLeft: 0.8, mouthSmileRight: 0.8,
  cheekSquintLeft: 0.25, cheekSquintRight: 0.25 }, blink: { eyeBlinkLeft: 1, eyeBlinkRight: 1 } };
report.heads = [];
const checkDir = join(root, "demo", "content", "check");
mkdirSync(checkDir, { recursive: true });
for (const pair of (values.heads ?? "").split(",").filter(Boolean)) {
  const [original, web] = pair.split("=");
  const name = basename(resolve(original, "..", ".."));
  const files = { original: `${name}-original.glb`, web: `${name}-web.glb` };
  copyFileSync(original, join(checkDir, files.original));
  copyFileSync(web, join(checkDir, files.web));
  const entry = { head: name, bytes: { original: statSync(original).size, web: statSync(web).size }, poses: {} };
  const page = await browser.newPage({ viewport: { width: 160, height: 160 } });
  const shots = {};
  for (const [kind, file] of Object.entries(files)) {
    await page.goto(`${BASE}head-check.html?glb=${encodeURIComponent(CONTENT + "check/" + file)}`);
    await page.waitForFunction(() => document.body.dataset.ready || document.body.dataset.error, null, { timeout: 60000 });
    entry[`${kind}_names`] = Number(await page.evaluate(() => document.body.dataset.ready));
    for (const [pose, weights] of Object.entries(POSES)) {
      await page.evaluate((w) => window.pose(w), weights);
      const shot = join(OUT, `head-${name}-${pose}-${kind}.png`);
      await page.screenshot({ path: shot });
      (shots[pose] ??= {})[kind] = shot;
    }
  }
  for (const [pose, s] of Object.entries(shots)) entry.poses[pose] = await diff(s.original, s.web);
  // How far apart two poses of the same head are, for scale.
  entry.jawOpen_vs_neutral = await diff(shots.neutral.original, shots.jawOpen.original);
  await page.close();
  report.heads.push(entry);
}

// ---- 2. the pages --------------------------------------------------------------------------------------------------
async function frameStats(page) {
  return page.evaluate(() => ({ ...window.widget.stats, last: window.widget.head?.last }));
}

async function openPage(file, query = "", options = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, ...options });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  watch(page, errors);
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(`${BASE}${file}${query}`);
  return { context, page, errors, requests };
}

const waitMode = (page) => page.waitForFunction(() => window.widget?.stats.mode, null, { timeout: 60000 });
const stage = (page) => page.locator("talking-head-widget").locator(".stage");

async function playChecks(file) {
  const r = { page: file };
  const { context, page, errors, requests } = await openPage(file);
  await waitMode(page);
  await page.waitForFunction(() => window.widget.stats.firstFrame !== null, null, { timeout: 60000 });
  r.first_frame_ms = Math.round(await page.evaluate(() => window.widget.stats.firstFrame));
  const box = await page.locator("talking-head-widget").boundingBox();
  r.corner = { right: Math.round(1000 - box.x - box.width), bottom: Math.round(700 - box.y - box.height) };
  r.before_click = await page.evaluate(() => ({ state: window.widget.stats.state,
    audio_requested: performance.getEntriesByType("resource").some((e) => /\.(webm|mp3)/.test(e.name)) }));
  await page.screenshot({ path: join(OUT, `${file}-idle.png`) });

  // Idle CPU: the main thread's task time and every Chromium process's CPU over 5 s.
  r.cpu_idle = await cpu(page, 5000);
  await stage(page).click();
  await page.waitForFunction(() => window.widget.stats.state === "playing", null, { timeout: 30000 });
  r.cpu_speaking = await cpu(page, 5000);
  const samples = [];
  for (let i = 0; i < 20; i++) {
    samples.push(await page.evaluate(() => window.widget.head.last.weights.jawOpen ?? 0));
    await sleep(50);
  }
  r.lipsync_jaw = { min: Math.min(...samples), max: Math.max(...samples) };
  r.caption = await page.evaluate(() => {
    const c = window.widget.element.shadowRoot.querySelector(".caption");
    return { hidden: c.hidden, text: c.textContent };
  });
  await page.screenshot({ path: join(OUT, `${file}-speaking.png`) });

  // The schedule's cues at their times: seek just past each one's ramp, then read the head's frame.
  const clip = JSON.parse(readFileSync(join(root, "demo", "content", "clips", `${CLIP}.clip.json`), "utf8"));
  r.cues = [];
  for (const cue of [...clip.schedule.emotes.map((e) => ({ ...e, kind: "emote" })),
    ...clip.schedule.looks.map((l) => ({ ...l, kind: "look" }))]) {
    const at = cue.t + (cue.kind === "emote" ? 0.5 : 0.4) + Math.min(0.3, cue.hold / 2);
    await page.evaluate((t) => { const a = window.widget.audio; a.currentTime = t; }, at);
    await sleep(250);
    const s = await frameStats(page);
    const t = await page.evaluate(() => window.widget.audio.currentTime);
    const w = s.last.weights;
    r.cues.push({ kind: cue.kind, t: cue.t, sampled_at: Number(t.toFixed(2)), ...(cue.kind === "emote"
      ? { emotion: cue.emotion, eyeWide: w.eyeWideLeft ?? 0, browOuterUp: w.browOuterUpLeft ?? 0,
        smile: w.mouthSmileLeft ?? 0 }
      : { yaw_wanted: cue.yaw, head_yaw: Number(s.last.pose.yaw.toFixed(2)), eyeLookOutLeft: w.eyeLookOutLeft ?? 0 }) });
    await page.screenshot({ path: join(OUT, `${file}-${cue.kind}-${cue.t}.png`), clip: { x: box.x - 320, y: box.y - 120,
      width: box.width + 320, height: box.height + 120 } });
  }
  // The end: the head's last frame has the mouth at rest.
  await page.evaluate(() => { const a = window.widget.audio; a.currentTime = a.duration - 0.3; });
  await page.waitForFunction(() => window.widget.stats.state === "idle", null, { timeout: 15000 });
  await sleep(200);
  const end = await frameStats(page);
  r.after_end = { state: end.state, jawOpen: end.last.weights.jawOpen ?? 0, caption_hidden: await page.evaluate(() =>
    window.widget.element.shadowRoot.querySelector(".caption").hidden) };

  // Hidden tab: no frames.
  const hidden = await page.evaluate(async () => {
    const w = window.widget;
    const set = (v) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
      document.dispatchEvent(new Event("visibilitychange")); };
    const a = w.stats.frames;
    set("hidden");
    await new Promise((r) => setTimeout(r, 600));
    const b = w.stats.frames;
    const rendering = w.stats.rendering;
    set("visible");
    await new Promise((r) => setTimeout(r, 600));
    return { frames_while_hidden: b - a, rendering_while_hidden: rendering, frames_after: w.stats.frames - b };
  });
  r.hidden_tab = hidden;
  r.errors = errors;
  r.three_requested = requests.filter((u) => u.includes("/node_modules/three/")).length;
  await context.close();
  return r;
}

async function hostileCheck(file) {
  // The same frame (rendering stopped, drawn at a fixed time) with and without the hostile stylesheet.
  const shots = [];
  const rects = [];
  for (const hostile of ["1", "0"]) {
    const { context, page } = await openPage(file, `?hostile=${hostile}`);
    await waitMode(page);
    await page.waitForFunction(() => window.widget.stats.firstFrame !== null, null, { timeout: 60000 });
    await page.evaluate(() => { window.widget.head.stop(); window.widget.head.draw(1000); });
    // Only the widget counts: the page behind its transparent corners is hidden in both shots (the hostile rules
    // still reach the widget's host element).
    await page.addStyleTag({ content: "html, body { background: #fff !important; border: 0 !important; } "
      + "head { display: none !important; } "  // hostile.css's `* { display: inline }` shows the scripts' text
      + "body > :not(talking-head-widget), body > :not(talking-head-widget) * { visibility: hidden !important; }" });
    const el = page.locator("talking-head-widget");
    rects.push(await el.boundingBox());
    const shot = join(OUT, `${file}-hostile-${hostile}.png`);
    await el.screenshot({ path: shot });
    shots.push(shot);
    await context.close();
  }
  return { rect_with: rects[0], rect_without: rects[1], pixel_diff: await diff(shots[0], shots[1]) };
}

async function mutedCheck(file) {
  const { context, page, errors } = await openPage(file, "?autoplay=muted&load=eager");
  await page.waitForFunction(() => window.widget?.stats.state === "playing", null, { timeout: 60000 });
  await sleep(1200);
  const before = await page.evaluate(() => ({ ...window.widget.stats, caption: !window.widget.element.shadowRoot
    .querySelector(".caption").hidden, t: window.widget.audio.currentTime }));
  await stage(page).click();
  await sleep(300);
  const after = await page.evaluate(() => ({ muted: window.widget.stats.muted, t: window.widget.audio.currentTime,
    state: window.widget.stats.state }));
  await context.close();
  return { before: { state: before.state, muted: before.muted, caption: before.caption, t: before.t }, after, errors };
}

async function stillCheck(file, how) {
  const launch = how === "no-webgl"
    ? await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis", "--disable-gpu"] }) : browser;
  const context = await launch.newContext({ viewport: { width: 1000, height: 700 },
    ...(how === "reduced-motion" ? { reducedMotion: "reduce" } : {}) });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  watch(page, errors);
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(`${BASE}${file}`);
  await waitMode(page);
  await sleep(500);
  const r = await page.evaluate(() => ({ ...window.widget.stats,
    still: !!window.widget.element.shadowRoot.querySelector(".view svg, .view img") }));
  await stage(page).click();
  await page.waitForFunction(() => window.widget.stats.state === "playing", null, { timeout: 30000 });
  await sleep(1500);
  const caption = await page.evaluate(() => !window.widget.element.shadowRoot.querySelector(".caption").hidden);
  await page.locator("talking-head-widget").screenshot({ path: join(OUT, `${file}-${how}.png`) });
  await context.close();
  if (launch !== browser) await launch.close();
  return { how, mode: r.mode, still: r.still, frames: r.frames, plays: true, caption, errors,
    head_or_three_requested: requests.filter((u) => /head\.glb|node_modules\/three/.test(u)).length };
}

async function offscreenCheck() {
  const { context, page, errors } = await openPage("offscreen.html");
  await page.waitForFunction(() => window.widget?.stats.mode === "3d", null, { timeout: 60000 });
  await sleep(800);
  const a = await page.evaluate(() => window.widget.stats);
  await sleep(800);
  const b = await page.evaluate(() => window.widget.stats);
  await page.evaluate(() => document.getElementById("slot").scrollIntoView());
  await sleep(800);
  const c = await page.evaluate(() => window.widget.stats);
  await context.close();
  return { frames_while_offscreen: b.frames - a.frames, rendering_offscreen: b.rendering,
    frames_once_visible: c.frames - b.frames, rendering_visible: c.rendering, errors };
}

/** CPU over `ms`: the page's main-thread task time (CDP), and the CPU time of every Chromium process (/proc). */
async function cpu(page, ms) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const procs = () => {
    let ticks = 0;
    for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (!/chrom/i.test(cmd) || !cmd.includes("ms-playwright")) continue;
        const f = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ");
        ticks += Number(f[11]) + Number(f[12]);
      } catch { /* gone */ }
    }
    return ticks / 100; // seconds (USER_HZ 100)
  };
  const [m0, p0, t0] = [await metric(), procs(), Date.now()];
  await sleep(ms);
  const [m1, p1, t1] = [await metric(), procs(), Date.now()];
  const wall = (t1 - t0) / 1000;
  await cdp.detach();
  return { main_thread_pct: Number((100 * (m1.TaskDuration - m0.TaskDuration) / wall).toFixed(1)),
    all_processes_pct_of_one_core: Number((100 * (p1 - p0) / wall).toFixed(1)) };
}

report.pages = [];
for (const file of ["script-tag.html", "esm.html"]) {
  const r = await playChecks(file);
  r.hostile = await hostileCheck(file);
  r.muted = await mutedCheck(file);
  r.still = [await stillCheck(file, "reduced-motion"), await stillCheck(file, "no-webgl")];
  report.pages.push(r);
}
report.offscreen = await offscreenCheck();

// ---- 3. sizes ------------------------------------------------------------------------------------------------------
const dist = join(root, "dist");
const chunks = readdirSync(join(dist, "chunks")).filter((f) => f.endsWith(".js"));
const threeFiles = ["build/three.module.js", "build/three.core.js"].map((f) => join(root, "node_modules", "three", f));
report.sizes = {
  iife_gz: gz(join(dist, "talking-head-widget.iife.js")),
  esm_widget_gz: gz(join(dist, "widget.js")),
  esm_chunks_gz: Object.fromEntries(chunks.map((f) => [f, gz(join(dist, "chunks", f))])),
  three_module_gz_unbundled: threeFiles.reduce((n, f) => n + gz(f), 0),
  head_glb: statSync(join(root, "demo", "content", "head.glb")).size,
  clip_manifest: statSync(join(root, "demo", "content", "clips", `${CLIP}.clip.json`)).size,
  clip_manifest_gz: gz(join(root, "demo", "content", "clips", `${CLIP}.clip.json`)),
  clip_webm: statSync(join(root, "demo", "content", "clips", `${CLIP}.webm`)).size,
  clip_mp3: statSync(join(root, "demo", "content", "clips", `${CLIP}.mp3`)).size,
};

await browser.close();
console.log(JSON.stringify(report, null, 2));
