# talking-head-widget: the embeddable talking head

An npm package (`@talking-head/widget`, prepared for a first public publish in THS-25) that puts a 3D talking head in a corner of any
website and plays clips made in the talking-head.dev studio. Workspace overview: `../CLAUDE.md`; design and
measurements: `../docs/embeddable-widget.md`; usage and commands: [`README.md`](README.md).

## What lives here
- **The head modules** (`src/three/`, `src/lipsync/`, `src/performance/`, `src/blendshapes.ts`), moved here from the web
  app in THS-20. `../talking-head-web` imports them from `@talking-head/widget/head` and compiles these sources
  itself (a `link:` dependency and the `talking-head-source` export condition): **a change here is a change there**,
  so run the web app's checks too (`yarn test:run && yarn lint && yarn build` in `../talking-head-web`). Keep them
  free of anything but `three`.
- **The widget** (`src/widget/`, `src/index.ts`, `src/iife.ts`): mount, Shadow DOM UI, playback, captions.
- **The clip format** (`src/clip.ts`, [`docs/clip-format.md`](docs/clip-format.md)) and **the web export**
  (`scripts/web-head.mjs`, `src/webHead.ts`, [`docs/web-head.md`](docs/web-head.md)): cross-repo interfaces.
  talking-head-server writes clips and runs the export; its `studio/tests/test_sync.py` checks `CLIP_FORMAT`,
  `CLIP_VERSION`, `CLIP_AUDIO`, `LIPSYNC_NAMES` (= the pipeline's `visemes.json` names) and the script's CLI and report.

## Commands
Yarn classic (never `npm install`), Node 24 from fnm.
```bash
yarn install --frozen-lockfile
yarn test:run                       # vitest (jsdom; scripts/*.test.ts in node)
yarn vitest run src/clip.test.ts    # one file; add -t "<name>" for one test
yarn typecheck && yarn lint && yarn build
node demo/serve.mjs                 # :5790 pages, :5791 demo/content/ (a studio project export, unzipped; git-ignored)
PLAYWRIGHT=~/projects/chess-app/chessapp-analyze-v1/node_modules/playwright node demo/check.mjs [--gl gpu]
```
`demo/check.mjs` is the browser check behind the measurements in the docs (both builds, the hostile stylesheet,
autoplay, power, still modes, sizes, first frame, CPU). Use `--gl gpu` for CPU numbers: the default SwiftShader is
software WebGL and costs ~7 cores for what the GPU does at ~7% of one.

## Gotchas
- Muted autoplay needs a `<video>` element: browsers refuse it for `<audio>` (the widget plays through a hidden
  `<video>`).
- Playwright's `page.evaluate` counts as a user gesture: test "no sound before a click" with the page's own script.
- `:host` rules need `!important`: inside a shadow root they then beat the host page's `!important` rules.

## Git
Repo `talking-head-dev/talking-head-widget`, a submodule of the workspace; work lands on `development`. Commit and
push only when asked.
