import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyOps, applyOpsLenient, parseOps } from "../src/base/ops.js";
import { extractBaseDoc, isBaseHtml, renderBaseHtml } from "../src/base/render.js";
import { emptyDoc, validateDoc } from "../src/base/schema.js";
import { ensurePreviewMonitor } from "../src/previewMonitor.js";

const polyhedra = `{"op":"reset"}
{"op":"meta","value":{"title":"Poliedros regulares","instructions":"Toca cada sólido para ver sus caras."}}
{"op":"env","value":{"sky":"#0b1020","lighting":"day"}}
{"op":"set","kind":"entity","id":"mesa","value":{"shape":"group","position":[0,1.2,-2.5]}}
{"op":"set","kind":"entity","id":"tetra","value":{"shape":"tetrahedron","parent":"mesa","position":[-1.5,0,0],"radius":0.4,"color":"#f97316","label":"Tetraedro","on":{"click":[{"do":"set","target":"info","prop":"text","value":"4 caras"}]}}}
{"op":"set","kind":"entity","id":"cubo","value":{"shape":"box","parent":"mesa","size":[0.6,0.6,0.6],"color":"#22c55e","tags":["solido"]}}
{"op":"set","kind":"ui","id":"panel","value":{"type":"panel","zone":"top-left","title":"Poliedros","text":"Selecciona un sólido."}}
{"op":"set","kind":"ui","id":"info","value":{"type":"text","parent":"panel","text":"Sin selección"}}
{"op":"set","kind":"script","id":"giro","value":"ctx.onTick((t, dt) => { ctx.entity('mesa').object3D.rotation.y += dt / 4000; });"}`;

describe("documento de la base", () => {
  it("la escena vacía es válida y trae el panel de bienvenida", () => {
    const doc = validateDoc(emptyDoc());
    assert.equal(doc.ui.info.type, "panel");
    assert.deepEqual(doc.entities, {});
  });

  it("construye una práctica completa con operaciones", () => {
    const doc = applyOps(emptyDoc(), parseOps(polyhedra));
    assert.equal(doc.title, "Poliedros regulares");
    assert.equal(doc.ui.info.parent, "panel");
    assert.equal(doc.entities.tetra.parent, "mesa");
    assert.deepEqual(doc.scripts.giro, { code: "ctx.onTick((t, dt) => { ctx.entity('mesa').object3D.rotation.y += dt / 4000; });" });
    assert.equal(doc.environment.floor, "#253748");
    assert.equal(doc.environment.lighting, "day");
    assert.equal(doc.ui.info.text, "Sin selección");
    assert.equal("info" in doc.entities, false);
  });

  it("merge cambia solo lo pedido y null borra", () => {
    const doc = applyOps(emptyDoc(), parseOps(polyhedra));
    const moved = applyOps(doc, parseOps(`{"op":"merge","kind":"ui","id":"panel","value":{"zone":"bottom","text":null}}
{"op":"merge","kind":"entity","id":"cubo","value":{"color":"#3b82f6"}}
{"op":"env","value":{"floor":null}}`));
    assert.equal(moved.ui.panel.zone, "bottom");
    assert.equal(moved.ui.panel.title, "Poliedros");
    assert.equal("text" in moved.ui.panel, false);
    assert.equal(moved.entities.cubo.color, "#3b82f6");
    assert.deepEqual(moved.entities.cubo.size, [0.6, 0.6, 0.6]);
    assert.equal(moved.environment.floor, null);
    assert.equal(doc.ui.panel.zone, "top-left", "el documento original no cambia");
  });

  it("acepta una lista JSON y bloques con cercas de Markdown", () => {
    const fromList = parseOps(`[{"op":"reset"},{"op":"set","kind":"style","id":"tema","value":".pb-panel{color:red}"}]`);
    assert.equal(fromList.length, 2);
    const fenced = parseOps("```json\n{\"op\":\"reset\"},\n```");
    assert.deepEqual(fenced, [{ op: "reset" }]);
  });

  it("rechaza todo el bloque si una operación deja el documento inválido", () => {
    const doc = applyOps(emptyDoc(), parseOps(polyhedra));
    assert.throws(() => applyOps(doc, parseOps(`{"op":"merge","kind":"entity","id":"cubo","value":{"color":"#00f"}}
{"op":"set","kind":"entity","id":"fantasma","value":{"shape":"box","parent":"nada"}}`)), /fantasma\.parent/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"merge","kind":"entity","id":"nuevo","value":{"color":"#000000"}}`)), /no existe/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"set","kind":"entity","id":"x","value":{"shape":"hexagon"}}`)), /shape/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"set","kind":"entity","id":"x","value":{"shape":"box","colour":"#ffffff"}}`)), /desconocida "colour"/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"set","kind":"ui","id":"cubo","value":{"type":"text"}}`)), /únicos/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"set","kind":"entity","id":"m","value":{"shape":"model","url":"http://inseguro.test/a.glb"}}`)), /https/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"set","kind":"ui","id":"hijo","value":{"type":"text","parent":"info"}}`)), /no puede contener/);
    assert.throws(() => parseOps(`{"op":"set","kind":"entity","id":"x","value":`), /no es JSON válido/);
    assert.throws(() => applyOps(doc, parseOps(`{"op":"set","kind":"style","id":"s","value":"</style><script>"}`)), /style/);
  });

  it("detecta ciclos de padres", () => {
    assert.throws(() => applyOps(emptyDoc(), parseOps(`{"op":"set","kind":"entity","id":"a","value":{"shape":"group","parent":"b"}}
{"op":"set","kind":"entity","id":"b","value":{"shape":"group","parent":"a"}}`)), /ciclo/);
  });
});

describe("HTML de la base", () => {
  it("embebe el documento sin permitir cerrar el script y lo recupera", () => {
    const doc = applyOps(emptyDoc(), parseOps(`{"op":"reset"}
{"op":"set","kind":"ui","id":"t","value":{"type":"text","text":"</script><script>alert(1)</script>"}}`));
    const html = renderBaseHtml(doc);
    assert.ok(isBaseHtml(html));
    assert.equal(html.match(/<\/script>/g)?.length, 3, "solo cierran A-Frame, el documento y el runtime");
    assert.deepEqual(extractBaseDoc(html), doc);
    assert.deepEqual(extractBaseDoc(ensurePreviewMonitor(html)), doc);
    assert.match(html, /aframe\.io\/releases\/1\.8\.0/);
    assert.match(html, /\/\*! ProfeIA base runtime/);
  });

  it("no confunde otro HTML con la base", () => {
    assert.equal(extractBaseDoc("<!doctype html><html><body>hola</body></html>"), undefined);
  });
});

describe("aplicación tolerante de operaciones", () => {
  it("descarta solo la pieza inválida y aplica el resto", () => {
    const { doc, problems } = applyOpsLenient(emptyDoc(), `{"op":"set","kind":"entity","id":"a","value":{"shape":"box"}}
{"op":"set","kind":"entity","id":"b","value":{"shape":"hexagono"}}
{"op":"set","kind":"entity","id":"c","value":{"shape":"sphere","parent":"b"}}
no es json
{"op":"set","kind":"ui","id":"panel","value":{"type":"panel","title":"Hola"}}`);
    assert.equal(doc.entities.a.shape, "box");
    assert.equal(doc.ui.panel.title, "Hola");
    assert.equal(doc.entities.b, undefined);
    assert.equal(doc.entities.c, undefined, "el hijo de una pieza descartada también sale");
    assert.ok(problems.some(problem => problem.id === "b" && problem.line?.includes("hexagono")));
    assert.ok(problems.some(problem => problem.line === "no es json"));
    assert.doesNotThrow(() => validateDoc(doc));
  });

  it("detecta scripts con error de sintaxis sin ejecutarlos", () => {
    const { doc, problems } = applyOpsLenient(emptyDoc(), `{"op":"set","kind":"script","id":"roto","value":"ctx.onTick(( => {"}
{"op":"set","kind":"script","id":"bien","value":"globalThis.__ejecutado = true;"}`);
    assert.equal(doc.scripts.roto, undefined);
    assert.ok(doc.scripts.bien);
    assert.equal((globalThis as Record<string, unknown>).__ejecutado, undefined);
    assert.ok(problems.some(problem => problem.kind === "script" && problem.id === "roto"));
  });

  it("un entorno inválido vuelve al anterior sin perder lo demás", () => {
    const { doc, problems } = applyOpsLenient(emptyDoc(), `{"op":"env","value":{"sky":"azul"}}
{"op":"set","kind":"entity","id":"a","value":{"shape":"box"}}`);
    assert.deepEqual(doc.environment, emptyDoc().environment);
    assert.ok(doc.entities.a);
    assert.ok(problems.some(problem => problem.kind === "environment"));
  });
});
