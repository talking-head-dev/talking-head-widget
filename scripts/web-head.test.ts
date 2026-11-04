// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { describe, expect, it } from "vitest";

/** A small head GLB in the studio's layout: a grid of vertices, three morph targets named in mesh extras. */
async function headGlb(path: string) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const n = 20;
  const positions = new Float32Array(n * n * 3);
  for (let i = 0; i < n * n; i++) positions.set([(i % n) / n, Math.floor(i / n) / n, 0], i * 3);
  const indices = new Uint16Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = y * n + x;
    indices.set([a, a + 1, a + n, a + 1, a + n + 1, a + n], k);
    k += 6;
  }
  const accessor = (array: Float32Array<ArrayBuffer> | Uint16Array<ArrayBuffer>, type: "VEC3" | "SCALAR") =>
    doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", accessor(positions, "VEC3"))
    .setIndices(accessor(indices, "SCALAR"));
  const names = ["jawOpen", "eyeBlink_L", "cheekRaiser_L"];
  names.forEach((name, t) => {
    const delta = new Float32Array(n * n * 3).map((_, j) => (j % 3 === t ? 0.01 : 0));
    prim.addTarget(doc.createPrimitiveTarget(name).setAttribute("POSITION", accessor(delta, "VEC3")));
  });
  const mesh = doc.createMesh("head").addPrimitive(prim).setWeights([0, 0, 0]).setExtras({ targetNames: names });
  doc.createScene().addChild(doc.createNode().setMesh(mesh));
  writeFileSync(path, await new NodeIO().writeBinary(doc));
}

describe("the head's web export", () => {
  it("keeps the targets the widget drives, compresses, and reports each step", async () => {
    const dir = mkdtempSync(join(tmpdir(), "web-head-"));
    await headGlb(join(dir, "head.glb"));
    const out = execFileSync(process.execPath, ["scripts/web-head.mjs", join(dir, "head.glb"), join(dir, "web.glb")],
      { encoding: "utf8" });
    const report = JSON.parse(out);
    expect(report.targets).toEqual(["jawOpen", "eyeBlink_L"]);
    expect(report.dropped).toEqual(["cheekRaiser_L"]);
    expect(report.arkit_names).toEqual(expect.arrayContaining(["jawOpen", "eyeBlinkLeft"]));
    expect(report.sizes.map((s: { step: string }) => s.step)).toEqual(["original", "drop targets", "quantize", "meshopt"]);

    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const doc = await io.read(join(dir, "web.glb"));
    const mesh = doc.getRoot().listMeshes()[0];
    expect(mesh.getExtras()).toMatchObject({ targetNames: ["jawOpen", "eyeBlink_L"] });
    expect(mesh.listPrimitives()[0].listTargets()).toHaveLength(2);
    const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
    expect(used).toEqual(expect.arrayContaining(["EXT_meshopt_compression", "KHR_mesh_quantization"]));
    expect(readFileSync(join(dir, "web.glb")).byteLength).toBe(report.bytes);

    // --keep adds names; a GLB that isn't a head is refused (exit 1), bad arguments are exit 2
    const kept = JSON.parse(execFileSync(process.execPath, ["scripts/web-head.mjs", join(dir, "head.glb"),
      join(dir, "web2.glb"), "--keep", "cheekRaiser_L"], { encoding: "utf8" }));
    expect(kept.dropped).toEqual([]);
    const fail = (args: string[]) => {
      try {
        execFileSync(process.execPath, ["scripts/web-head.mjs", ...args], { stdio: "pipe" });
        return 0;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };
    expect(fail([join(dir, "head.glb")])).toBe(2);
    writeFileSync(join(dir, "junk.glb"), "junk");
    expect(fail([join(dir, "junk.glb"), join(dir, "x.glb")])).toBe(1);
  });

  it("carries the hair shell and fur through and caps their texture separately", async () => {
    const dir = mkdtempSync(join(tmpdir(), "web-head-hair-"));
    await headGlb(join(dir, "head.glb"));
    // Add a hair shell and one fur layer with an M_Hair* material and a texture.
    const io0 = new NodeIO();
    const doc = await io0.read(join(dir, "head.glb"));
    const { default: sharp } = await import("sharp");
    const raw = Buffer.from(Array.from({ length: 8 * 8 * 4 }, (_, i) => (i * 37) % 251));   // not a solid colour: prune keeps it
    const png = await sharp(raw, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const texture = doc.createTexture().setImage(new Uint8Array(png)).setMimeType("image/png");
    const base = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const pos = base.getAttribute("POSITION")!;
    const uvs = doc.createAccessor().setType("VEC2").setBuffer(pos.getBuffer())
      .setArray(new Float32Array((pos.getArray() as Float32Array).filter((_, i) => i % 3 !== 2)));
    for (const [meshName, matName] of [["AvatarHair", "M_Hair"], ["AvatarHairFur1", "M_HairFur1"]] as const) {
      const material = doc.createMaterial(matName).setBaseColorTexture(texture);
      if (matName.includes("Fur")) material.setAlphaMode("MASK").setAlphaCutoff(0.45);
      const prim = doc.createPrimitive()
        .setAttribute("POSITION", pos).setAttribute("TEXCOORD_0", uvs).setIndices(base.getIndices()).setMaterial(material);
      doc.getRoot().listScenes()[0].addChild(doc.createNode(meshName).setMesh(doc.createMesh(meshName).addPrimitive(prim)));
    }
    writeFileSync(join(dir, "haired.glb"), await io0.writeBinary(doc));

    const out = execFileSync(process.execPath, ["scripts/web-head.mjs", join(dir, "haired.glb"), join(dir, "web.glb"),
      "--hair-texture", "64"], { encoding: "utf8" });
    const report = JSON.parse(out);
    expect(report.hair).toMatchObject({ fur_layers: 1, texture: 64 });
    expect(report.hair.meshes).toEqual(expect.arrayContaining(["AvatarHair", "AvatarHairFur1"]));
    expect(report.sizes.map((s: { step: string }) => s.step)).toContain("hair texture 64 webp");
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
    const web = await io.read(join(dir, "web.glb"));
    expect(web.getRoot().listMeshes().map((m) => m.getName()))
      .toEqual(expect.arrayContaining(["AvatarHair", "AvatarHairFur1"]));
    const fur = web.getRoot().listMaterials().find((m) => m.getName() === "M_HairFur1");
    expect(fur?.getAlphaMode()).toBe("MASK");
  });
});
