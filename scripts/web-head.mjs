#!/usr/bin/env node
/**
 * **The head's web export**: a widget-sized GLB from any of the workspace's 55-target head GLBs (an avatar's, a THS-7
 * head's). Run by talking-head-server (`?variant=web` on the head-model routes and the project export) as a
 * subprocess, and by hand:
 *
 *   node scripts/web-head.mjs IN.glb OUT.glb [--keep a,b,…] [--ratio 0.5] [--texture 512] [--report out.json]
 *
 * Steps (docs/web-head.md): drop the morph targets the widget never drives, decimate with the targets, a smaller
 * WebP texture, quantize (KHR_mesh_quantization), compress (EXT_meshopt_compression). The GLB interface is kept: the
 * kept targets' names in `meshes[0].extras.targetNames`, the orientation and the scale; `meshes[0].extras.arkitNames`
 * lists the ARKit names the head can show (the coverage checker reads it).
 *
 * Prints one JSON object on stdout: the kept names, the size after each step, the vertex counts. Exit 2 on bad
 * arguments, 1 when the export fails.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, prune, quantize, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

import { resolveCategory } from "../src/blendshapes.ts";
import { WEB_HEAD_NAMES } from "../src/webHead.ts";

export const DEFAULTS = { ratio: 1, error: 0.0005, texture: 512, quality: 82 };

function usage(message) {
  process.stderr.write(`web-head: ${message}\n`);
  process.exit(2);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    keep: { type: "string" },
    ratio: { type: "string" },
    texture: { type: "string" },
    report: { type: "string" },
  },
});
if (positionals.length !== 2) usage("usage: web-head.mjs IN.glb OUT.glb [--keep a,b] [--ratio R] [--texture PX]");
const [input, output] = positionals;
const extra = (values.keep ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const ratio = values.ratio === undefined ? DEFAULTS.ratio : Number(values.ratio);
const texture = values.texture === undefined ? DEFAULTS.texture : Number(values.texture);
if (!(ratio > 0 && ratio <= 1)) usage("--ratio must be in (0, 1]");
if (!(texture >= 16 && texture <= 4096)) usage("--texture must be 16-4096");

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const sizes = [];
const measure = async (step, doc) => sizes.push({ step, bytes: (await io.writeBinary(doc)).byteLength });

try {
  const source = new Uint8Array(await readFile(input));
  const doc = await io.readBinary(source);
  doc.setLogger(new Logger(Logger.Verbosity.SILENT)); // stdout is the JSON report
  sizes.push({ step: "original", bytes: source.byteLength });
  const vertices = () => doc.getRoot().listMeshes()
    .flatMap((m) => m.listPrimitives()).reduce((n, p) => n + p.getAttribute("POSITION").getCount(), 0);
  const before = vertices();

  // 1. Drop the targets the widget never drives.
  const arkit = [...new Set([...WEB_HEAD_NAMES, ...extra])];
  const keepTargets = new Set(arkit.flatMap((name) => resolveCategory(name, 0).map((a) => a.target)));
  const mesh = doc.getRoot().listMeshes().find((m) => Array.isArray(m.getExtras().targetNames));
  if (!mesh) throw new Error("no mesh with extras.targetNames: not a head GLB");
  const names = mesh.getExtras().targetNames;
  const kept = names.map((n, i) => [n, i]).filter(([n]) => keepTargets.has(n));
  for (const prim of mesh.listPrimitives()) {
    const targets = prim.listTargets();
    if (targets.length !== names.length) throw new Error(`a primitive has ${targets.length} targets, not ${names.length}`);
    targets.forEach((t, i) => { if (!keepTargets.has(names[i])) prim.removeTarget(t); });
  }
  const shown = arkit.filter((name) => resolveCategory(name, 0).some((a) => names.includes(a.target)));
  mesh.setWeights(kept.map(() => 0));
  mesh.setExtras({ ...mesh.getExtras(), targetNames: kept.map(([n]) => n), arkitNames: shown });
  await doc.transform(prune());
  await measure("drop targets", doc);

  // 2. Decimate, the morph targets with the mesh (meshopt's simplifier remaps every attribute, targets included).
  if (ratio < 1) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: DEFAULTS.error }));
    await measure(`decimate ${ratio}`, doc);
  }

  // 3. A smaller texture, as WebP.
  if (doc.getRoot().listTextures().length) {
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texture, texture],
      quality: DEFAULTS.quality }));
    await measure(`texture ${texture} webp`, doc);
  }

  // 4. Quantize to 16-bit (KHR_mesh_quantization), then 5. compress (EXT_meshopt_compression).
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }));
  await measure("quantize", doc);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const bytes = await io.writeBinary(doc);
  sizes.push({ step: "meshopt", bytes: bytes.byteLength });
  await writeFile(output, bytes);

  const report = { output, bytes: bytes.byteLength, sizes, targets: kept.map(([n]) => n), arkit_names: shown,
    dropped: names.filter((n) => !keepTargets.has(n)), vertices: { before, after: vertices() } };
  if (values.report) await writeFile(values.report, JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report) + "\n");
} catch (error) {
  process.stderr.write(`web-head: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
