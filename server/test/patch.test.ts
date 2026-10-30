import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyHtmlEdits, applyPatchResponse, applySceneOps, PatchError } from "../src/patch.js";
import { compileSceneResponse, extractSceneSpec } from "../src/sceneTemplate.js";

const scene = {
  version: 1,
  title: "Museo",
  instructions: "Explora.",
  objects: [
    { id: "cubo", shape: "box", position: [0, 1, -3], color: "#ff0000", action: "info", info: "Hola" },
    { id: "esfera", shape: "sphere", position: [2, 1, -3] },
  ],
};
const sceneHtml = compileSceneResponse(`<webxr-scene>${JSON.stringify(scene)}</webxr-scene>`).replace(/<\/?webxr-html>/g, "");

describe("parches de escena", () => {
  it("aplica add, update (con null), remove y setRoot", () => {
    const result = applySceneOps(JSON.stringify(scene), JSON.stringify({ ops: [
      { op: "add", object: { id: "cono", shape: "cone", position: [0, 1, -5] } },
      { op: "update", id: "cubo", set: { color: "#00ff00", action: null, info: null } },
      { op: "remove", id: "esfera" },
      { op: "setRoot", set: { sky: "#000000" } },
    ] })) as typeof scene & { sky: string };
    assert.deepEqual(result.objects.map(o => o.id), ["cubo", "cono"]);
    assert.equal(result.objects[0].color, "#00ff00");
    assert.equal("action" in result.objects[0], false);
    assert.equal(result.sky, "#000000");
  });

  it("rechaza ids inexistentes y operaciones desconocidas", () => {
    assert.throws(() => applySceneOps(JSON.stringify(scene), '{"ops":[{"op":"remove","id":"nada"}]}'), PatchError);
    assert.throws(() => applySceneOps(JSON.stringify(scene), '{"ops":[{"op":"mover"}]}'), PatchError);
    assert.throws(() => applySceneOps(JSON.stringify(scene), '{"ops":[]}'), PatchError);
  });

  it("regenera el HTML y conserva el resumen en applyPatchResponse", () => {
    const patch = '<webxr-patch>{"ops":[{"op":"update","id":"cubo","set":{"color":"#0000ff"}}]}</webxr-patch><assistant-response>Listo</assistant-response>';
    const out = applyPatchResponse(patch, sceneHtml);
    assert.match(out, /^<webxr-html>\n<!doctype html>/i);
    assert.match(out, /<assistant-response>Listo<\/assistant-response>/);
    const html = out.split("</webxr-html>")[0].replace("<webxr-html>", "");
    assert.equal(JSON.parse(extractSceneSpec(html) ?? "null").objects[0].color, "#0000ff");
  });

  it("falla si el resultado no valida", () => {
    const patch = '<webxr-patch>{"ops":[{"op":"remove","id":"cubo"},{"op":"remove","id":"esfera"}]}</webxr-patch>';
    assert.throws(() => applyPatchResponse(patch, sceneHtml), PatchError);
  });
});

describe("parches de HTML libre", () => {
  const html = "<html><body><h1>Hola</h1><p>Hola mundo</p></body></html>";

  it("aplica ediciones en orden", () => {
    const out = applyPatchResponse(
      "<webxr-patch><edit><search><h1>Hola</h1></search><replace><h1>Adiós</h1></replace></edit><edit><search>mundo</search><replace>XR</replace></edit></webxr-patch><assistant-response>ok</assistant-response>",
      html,
    );
    assert.match(out, /<h1>Adiós<\/h1><p>Hola XR<\/p>/);
    assert.match(out, /<assistant-response>ok<\/assistant-response>$/);
  });

  it("rechaza búsquedas ausentes, repetidas o vacías y es atómico", () => {
    assert.throws(() => applyHtmlEdits(html, [{ search: "nada", replace: "x" }]), /no existe/);
    assert.throws(() => applyHtmlEdits(html, [{ search: "Hola", replace: "x" }]), /no es único/);
    assert.throws(() => applyHtmlEdits(html, [{ search: "", replace: "x" }]), PatchError);
    assert.throws(() => applyPatchResponse("<webxr-patch>sin ediciones</webxr-patch>", html), PatchError);
  });

  it("exige documento vigente y parche completo", () => {
    assert.throws(() => applyPatchResponse("<webxr-patch><edit>", html), /incompleto/);
    assert.throws(() => applyPatchResponse("<webxr-patch></webxr-patch>", undefined), /vigente/);
  });
});
