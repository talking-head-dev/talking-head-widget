# talking-head-widget

An embeddable 3D talking head for any website: a package that puts the head in a corner of the page, where a text
chat bubble usually sits, and plays clips prepared in the talking-head.dev studio: the voice, lip sync, emotions and
glances, with captions.

Part of the [talking-head.dev](https://github.com/talking-head-dev/talking-head.dev) workspace, where it's a
submodule. Design and measurements: the workspace's `docs/embeddable-widget.md`. Tracked in Jira as THS-20.

**npm name:** `@talking-head/widget` (renamed in THS-25, once the user registered the `talking-head` org on npm).
**Not yet published**: version `0.1.0` is prepared for a first public publish — see Publishing below. The licence
is still `UNLICENSED` until the user picks one, so do not publish before that.

## Embed it

One `<script>` tag (three.js bundled, 172 KB gzipped):

```html
<script src="https://cdn.example.com/talking-head-widget.iife.js"
  data-head="https://cdn.example.com/eve/head.glb"
  data-clips='{"welcome": "https://cdn.example.com/eve/clips/segment-01.clip.json"}'
  data-autoplay="on-click" async></script>
```

or a call, after the script: `TalkingHeadWidget.mount({ head, clips, … })`. With npm (`npm install
@talking-head/widget`; three.js is a dependency, so a site that already has it doesn't download it twice; the mount
code is 7 KB gzipped and three.js loads only when the widget first shows):

```js
import { TalkingHeadWidget } from "@talking-head/widget";

const head = TalkingHeadWidget.mount({
  head: "/eve/head.glb",                         // a web head: the studio's project export, or scripts/web-head.mjs
  clips: { welcome: "/eve/clips/segment-01.clip.json", pricing: "/eve/clips/segment-02.clip.json" },
  position: "bottom-right",                      // "bottom-left", or "inline" with `container`
  size: 160,                                     // px; at most 112 below 480 px wide
  offset: { x: 24, y: 24 },
  autoplay: "on-click",                          // "muted": plays the first clip muted with captions; false: page decides
  captions: true,
  idle: true,                                    // blink, breathe, small head motion between clips
  load: "on-visible",                            // "idle" | "eager": when three.js, the head and the first clip load
  poster: "/eve/still.jpg",                      // optional: the still for reduced motion and no WebGL
});

head.play("pricing");                            // the first clip by default; a click on the head does the same
head.pause(); head.stop();
const off = head.on("ended", (id) => console.log(id));   // also "ready" ({ mode }), "play", "pause", "error"
head.destroy();
```

The files come from the studio: a project's **Export for the widget** (talking-head-server's
`GET /api/v1/projects/{id}/export/`) is a zip with `head.glb`, `clips/` and a README with this snippet. Host them on
any server that sends CORS headers (`Access-Control-Allow-Origin`), the head and clips can be on a CDN.

### What it does on someone else's page

- **Isolation:** everything renders in a Shadow DOM root on a `<talking-head-widget>` element. The host element resets
  every property with `!important` from inside its shadow root, which beats the page's own `!important` rules, so a
  global stylesheet (`* { … !important }`) changes nothing (checked: `demo/hostile.css`). Sizes are px, not rem.
- **Sound:** none before the visitor clicks. `"muted"` autoplay plays through a muted `<video>` element (browsers
  allow muted autoplay for video only) and a click unmutes it from the start.
- **Power:** the render loop stops off-screen (`IntersectionObserver`), in a hidden tab, and minimised; it draws at
  `idleFps` (30) between clips. With `prefers-reduced-motion` or without WebGL, a still (`poster`, or a silhouette)
  and three.js isn't even loaded; clips still play as sound and captions.
- **Accessibility:** the head is a button whose name says what a click does (play, stop, unmute); the clip's text is
  its description; a minimise button, remembered in `localStorage`; captions are visual only (the text is the
  accessible version). The strings are English; `labels` replaces them.

## The pieces

| Path | What |
|---|---|
| `src/index.ts` | `@talking-head/widget`: `TalkingHeadWidget`, the clip reader, captions |
| `src/head.ts` | `@talking-head/widget/head`: the head modules alone (the talking-head.dev web app imports these) |
| `src/widget/` | the widget: mount, Shadow DOM UI and styles, playback, captions |
| `src/three/` | `TalkingHeadViewport` (renderer, framing, neck pivot, meshopt decoding, start/stop, fps cap), lighting, material repair |
| `src/lipsync/`, `src/performance/`, `src/blendshapes.ts` | ARKit names and mixing, timelines and their player; emotions, glances, idle layer, performer; ARKit → GLB target names |
| `src/clip.ts` | the clip format, `talking-head-clip` v1 ([`docs/clip-format.md`](docs/clip-format.md)) |
| `src/webHead.ts`, `scripts/web-head.mjs` | the head's web export ([`docs/web-head.md`](docs/web-head.md)) |
| `src/iife.ts` | the script-tag build's entry (`window.TalkingHeadWidget`, `data-*` options) |
| `demo/` | pages for the two builds, a static server with a second "CDN" origin, the browser checks |

## Commands

Yarn classic, Node from fnm (as the web app). `yarn install --frozen-lockfile` first.

```bash
yarn build          # tsc (types into dist/types), vite build (ESM: dist/widget.js, head.js, chunks/), vite build --mode iife
yarn test:run       # vitest: the head modules, the clip format, captions, the widget on jsdom, the export script
yarn vitest run src/clip.test.ts -t "refuses"   # one file / one test
yarn typecheck && yarn lint
node scripts/web-head.mjs head.glb head.web.glb [--keep a,b] [--ratio 0.5] [--texture 512]
node demo/serve.mjs  # :5790 the demo pages, :5791 demo/content/ (unzip a studio project export there) with CORS
PLAYWRIGHT=…/node_modules/playwright node demo/check.mjs [--gl gpu] [--heads orig.glb=web.glb,…]   # browser checks
```

The web app compiles this package's TypeScript directly: its `package.json` has
`"@talking-head/widget": "link:../talking-head-widget"`, and its Vite and TypeScript configs pick the
`talking-head-source` export condition (`src/*.ts`) over `dist/`. So nothing needs building for the web app, and a
change here is a change there: run its checks too (`yarn test:run && yarn lint && yarn build` in
`../talking-head-web`).

## Publishing

Releases publish from GitHub Actions with npm trusted publishing (OIDC) — no long-lived npm token. The workflow
is `.github/workflows/publish.yml`: on a GitHub Release (or a manual `workflow_dispatch`) it installs with
`yarn install --frozen-lockfile`, runs the tests, typecheck, lint and build, then `npm publish --access public`
with `id-token: write`; provenance is automatic (`publishConfig.provenance`).

First publish (user-side, THS-25): pick a licence and replace `UNLICENSED` in `package.json` first. Then publish
`0.1.0` once by hand from a logged-in npm session (`npm login`, `yarn build`, `npm publish --access public`) —
a Trusted Publisher can only be configured for a package that already exists. Afterwards, on npmjs.com open the
package's Settings → Trusted Publisher → GitHub Actions and enter organisation `talking-head-dev`, repository
`talking-head-widget`, workflow filename `publish.yml`, environment blank. Later releases then need no token.

## Licenses

The code is the workspace's (private for now). Heads made from ICT-FaceKit carry its MIT notice, and the IIFE build
bundles three.js (MIT): [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), which goes with any copy of the package or
a head it serves. A head made from photos of a real person needs that person's consent before it goes on another site.
