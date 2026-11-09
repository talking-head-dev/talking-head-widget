// @vitest-environment node
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { repairModelMaterials } from "./materials";

function modelWith(material: THREE.Material) {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
  return root;
}

describe("repairModelMaterials and the hair fur", () => {
  it("keeps a fur layer's alpha cutout instead of making it a solid husk", () => {
    const fur = new THREE.MeshStandardMaterial({ name: "M_HairFur1", color: 0xffffff });
    fur.alphaTest = 0.45;   // what GLTFLoader sets for alphaMode MASK
    const report = repairModelMaterials(modelWith(fur));
    expect(report.furMaterials).toBe(1);
    expect(fur.alphaTest).toBe(0.45);
    expect(fur.transparent).toBe(false);   // cutout, not a blended transparent shell
  });

  it("keeps the hair cards single-sided, their cutout and their vertex colours", () => {
    const cards = new THREE.MeshStandardMaterial({ name: "M_HairCards", color: 0xffffff, vertexColors: true });
    cards.alphaTest = 0.4;
    cards.side = THREE.FrontSide;   // what GLTFLoader sets for doubleSided: false
    const report = repairModelMaterials(modelWith(cards));
    expect(report.cardMaterials).toBe(1);
    expect(cards.side).toBe(THREE.FrontSide);
    expect(cards.alphaTest).toBe(0.4);
    expect(cards.vertexColors).toBe(true);
  });

  it("keeps the scalp cap's dark colour and vertex colours (it is meant to be dark)", () => {
    const cap = new THREE.MeshStandardMaterial({ name: "M_HairCap", color: 0xffffff, vertexColors: true });
    const report = repairModelMaterials(modelWith(cap));
    expect(report.capMaterials).toBe(1);
    expect(cap.vertexColors).toBe(true);
    expect(cap.color.getHex()).toBe(0xffffff);   // white factor over COLOR_0, untouched
    const old = new THREE.MeshStandardMaterial({ name: "M_HairCap", color: new THREE.Color(0.03, 0.01, 0.005) });
    repairModelMaterials(modelWith(old));
    expect(old.color.r).toBeCloseTo(0.03);       // an old export's single dark colour is not lifted to grey-brown
  });

  it("still repairs an ordinary material as before", () => {
    const skin = new THREE.MeshPhysicalMaterial({ name: "M_Skin", color: 0xffffff });
    skin.transmission = 1;
    const report = repairModelMaterials(modelWith(skin));
    expect(report.furMaterials).toBe(0);
    expect(report.transmissionCleared).toBe(1);
    expect(skin.transmission).toBe(0);
  });
});
