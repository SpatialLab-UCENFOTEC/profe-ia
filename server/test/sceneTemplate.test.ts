import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Script } from "node:vm";
import { compileSceneResponse, extractSceneSpec, renderScene } from "../src/sceneTemplate.js";

const scene = {
  version: 1,
  title: "Museo del espacio",
  instructions: "Selecciona los planetas para conocerlos.",
  sky: "#071122",
  objects: [
    { id: "sol", shape: "sphere", position: [0, 2, -5], radius: 1, color: "#ffcc00", action: "info", info: "Nuestra estrella" },
    { id: "etiqueta", shape: "text", position: [0, 3.4, -5], text: "El Sol" },
  ],
};

describe("motor de escenas WebXR", () => {
  it("ensambla un HTML completo, interactivo y recupera la escena para cambios posteriores", () => {
    const response = compileSceneResponse(`<webxr-scene>${JSON.stringify(scene)}</webxr-scene><assistant-response>Explora la escena.</assistant-response>`);
    assert.match(response, /^<webxr-html>\s*<!doctype html>/i);
    assert.match(response, /<a-scene/);
    assert.match(response, /vr-mode-ui="enabled: true"/);
    assert.match(response, /<a-cursor/);
    assert.match(response, /<assistant-response>Explora la escena.<\/assistant-response>/);
    const html = response.split("</webxr-html>")[0].replace("<webxr-html>", "");
    const runtime = /<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i.exec(html)?.[1];
    assert.ok(runtime);
    assert.doesNotThrow(() => new Script(runtime));
    assert.deepEqual(JSON.parse(extractSceneSpec(html) ?? "null"), scene);
  });

  it("escapa contenido del modelo y rechaza acciones con referencias rotas", () => {
    const html = renderScene({ ...scene, title: '</title><script>alert(1)</script>', objects: [
      { id: "imagen", shape: "image", position: [0, 1, -3], url: "https://example.com/a?x=1&y=2", action: "info", info: "</script><script>alert(1)</script>" },
    ] });
    assert.doesNotMatch(html, /<title><\/title><script>alert/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /a\?x=1&amp;y=2/);
    assert.throws(() => renderScene({ ...scene, objects: [{ id: "a", shape: "box", position: [0, 0, 0], action: "toggle-visibility", target: "missing" }] }), /no existe/);
    assert.throws(() => renderScene({ ...scene, objects: [{ id: "a", shape: "model", position: [0, 0, 0], url: "javascript:alert(1)" }] }), /HTTPS/);
  });
});
