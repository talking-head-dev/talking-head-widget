# The head's web export

`scripts/web-head.mjs` makes a widget-sized GLB from any of the workspace's 55-target head GLBs (an avatar's, a THS-7
head's), with gltf-transform, meshoptimizer and sharp:

```bash
node scripts/web-head.mjs IN.glb OUT.glb [--keep a,b,…] [--ratio 0.5] [--texture 512] [--report report.json]
```

It prints one JSON object (`output`, `bytes`, `sizes` after each step, `targets` kept, `arkit_names`, `dropped`,
`vertices`); exit 2 on bad arguments, 1 when the export fails. talking-head-server runs it (`heads/web.py`) for
`?variant=web` on `GET /api/v1/avatars/{id}/head-model/` and `GET /api/v1/heads/{id}/model/`, and for the project
export, and keeps the result beside the source (`head.web.glb`).

**Why a Node script in this repo** rather than Python in talking-head-avatar: gltf-transform, meshoptimizer's encoder
and sharp are JavaScript (Python has no maintained meshopt encoder); the encoder and the decoder the widget loads
(three's `MeshoptDecoder`) stay in one repo and move together; and the kept names come from this package's own
`src/webHead.ts` and `src/blendshapes.ts`, which the script imports directly (Node 24 runs the TypeScript).

## The steps

1. **Drop the targets the widget never drives.** It keeps `WEB_HEAD_NAMES` (`src/webHead.ts`): the performance
   layer's names (the five emotions' presets, the glances' eye shapes, blinks and saccades: 27) and the default
   lip-sync profile's 14 mouth shapes, 38 ARKit names (39 GLB targets: `browInnerUp` is a pair). Dropped: `jawForward`,
   `jawLeft`, `jawRight`, `mouthLeft`, `mouthRight`, the dimples, the shrugs, `mouthRollUpper`, `cheekPuff`, the
   `cheekRaiser` pair (nothing drives them) and `noseSneer`. `--keep` adds names: the server's project export passes
   every name its clips' timelines use, so a clip made with another lip-sync profile still moves.
2. **Decimate** with the morph targets (`weld`, then meshopt's simplifier, which remaps every attribute, targets
   included): off by default (`--ratio 1`), since the size target is met without it.
3. **The texture** at 512 px as WebP (quality 82).
4. **Quantize** (`KHR_mesh_quantization`): positions 14 bits, normals 10, UVs 12, colours 8; the morph deltas with
   them.
5. **Compress** (`EXT_meshopt_compression`, level medium). three's `GLTFLoader` decodes it with `MeshoptDecoder`
   (`TalkingHeadViewport` always sets it).

The GLB keeps the interface the viewport relies on: the kept targets' names in `meshes[0].extras.targetNames`, the
orientation and the scale. It adds `meshes[0].extras.arkitNames`, the ARKit names it can show, which the web app's
coverage checker (`talking-head-web/docs/head-model/check-blendshape-coverage.mjs`) checks instead of all 51.

## Measured (2026-10-29)

Sizes after each step, in bytes:

| Step | Avatar head (`acd93e3d`) | THS-7 head (`dd2b5718`) |
|---|---|---|
| original | 11,428,056 | 11,197,332 |
| drop targets (55 → 39) | 7,214,232 | 6,890,212 |
| texture 512 px WebP | 6,994,060 | (no texture: flat skin) |
| quantize | 8,135,488 ¹ | 8,078,288 ¹ |
| **meshopt** | **1,066,104** | **1,009,824** |

¹ Larger than the step before (the 16-bit morph deltas aren't stored sparse any more); quantizing is what lets
meshopt's codec shrink them, mostly zeros, to almost nothing.

Variants, avatar head: keeping all 53 driven targets, 1,454,844; decimated to half the triangles (`--ratio 0.5`,
23,618 → 16,504 vertices), 698,884. A second avatar: 1,077,652. One export takes about 1 s.

**The same at 160 px** (`demo/check.mjs --heads`, headless Chromium, the original and the export drawn by the same
viewport in four poses: neutral, jawOpen 0.8, a smile, a blink): the mean difference per channel is 0.18 of 255 for
the avatar (the WebP texture) and 0.01 for the THS-7 head, against 1.26 and 0.81 between the neutral and jawOpen
poses of the same head: no visible difference. `check-blendshape-coverage.mjs` passes on both exports (38 of 38 kept
names resolve, every kept target driven).
