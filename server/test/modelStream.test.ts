import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractBaseDoc } from "../src/base/render.js";
import { emptyDoc } from "../src/base/schema.js";
import { processModelStream } from "../src/modelStream.js";
import type { ReplyChunk } from "../src/types.js";

async function* chunks(...values: string[]) {
  for (const value of values) yield value;
}

async function collect(stream: AsyncIterable<ReplyChunk>) {
  const result: ReplyChunk[] = [];
  for await (const chunk of stream) result.push(chunk);
  return result;
}

const ops = [
  "<webxr-ops>\n",
  "{\"op\":\"reset\"}\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"cubo\",\"value\":{\"shape\":\"box\",\"color\":\"#ff0000\"}}\n",
  "{\"op\":\"set\",\"kind\":\"ui\",\"id\":\"panel\",\"value\":{\"type\":\"panel\",\"title\":\"Hola\"}}\n",
  "</webxr-ops>\n<assistant-response>Listo</assistant-response>",
];

describe("procesamiento de la salida del modelo", () => {
  it("emite borradores en vivo y termina con el HTML de la base y el resumen", async () => {
    let clock = 0;
    const result = await collect(processModelStream(chunks(...ops), { baseDoc: emptyDoc(), now: () => (clock += 1000) }));
    const drafts = result.filter(chunk => typeof chunk !== "string" && chunk.kind === "doc");
    assert.ok(drafts.length >= 2, "al menos un borrador por tramo");
    const last = drafts.at(-1);
    assert.ok(last && typeof last !== "string" && last.kind === "doc");
    assert.equal(last.doc.entities.cubo.color, "#ff0000");
    const text = result.filter(chunk => typeof chunk === "string").join("");
    assert.match(text, /^<webxr-html><!doctype html>/);
    assert.match(text, /<\/webxr-html>\n<assistant-response>Listo<\/assistant-response>$/);
    const doc = extractBaseDoc(text.slice("<webxr-html>".length, text.indexOf("</webxr-html>")));
    assert.equal(doc?.ui.panel.title, "Hola");
    assert.equal(doc?.ui.info, undefined, "reset quita el panel de bienvenida");
  });

  it("limita la frecuencia de borradores", async () => {
    const result = await collect(processModelStream(chunks(...ops), { baseDoc: emptyDoc(), now: () => 0 }));
    assert.equal(result.filter(chunk => typeof chunk !== "string" && chunk.kind === "doc").length, 0);
  });

  it("deja pasar el HTML libre sin tocarlo", async () => {
    const raw = ["<webxr-html><!doctype html>", "<html></html></webxr-html>", "<assistant-response>ok</assistant-response>"];
    const result = await collect(processModelStream(chunks(...raw), { baseDoc: emptyDoc() }));
    assert.deepEqual(result, raw);
  });

  it("una respuesta conversacional no cambia la experiencia", async () => {
    const result = await collect(processModelStream(chunks("<assistant-response>", "Un poliedro es...</assistant-response>"), { baseDoc: emptyDoc() }));
    assert.deepEqual(result, ["<assistant-response>Un poliedro es...</assistant-response>"]);
  });

  it("pide una corrección con el motivo cuando las operaciones no aplican", async () => {
    const reasons: string[] = [];
    const result = await collect(processModelStream(
      chunks("<webxr-ops>\n{\"op\":\"merge\",\"kind\":\"entity\",\"id\":\"nada\",\"value\":{\"color\":\"#000000\"}}\n</webxr-ops><assistant-response>x</assistant-response>"),
      {
        baseDoc: emptyDoc(),
        retry: async (failed, reason) => {
          reasons.push(reason);
          assert.match(failed, /webxr-ops/);
          return chunks("<webxr-ops>\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"nada\",\"value\":{\"shape\":\"sphere\"}}\n</webxr-ops><assistant-response>Corregido</assistant-response>");
        },
      },
    ));
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /no existe/);
    const text = result.filter(chunk => typeof chunk === "string").join("");
    assert.match(text, /Corregido/);
    assert.equal(extractBaseDoc(text)?.entities.nada.shape, "sphere");
  });

  it("si la corrección también falla, avisa y conserva la versión anterior", async () => {
    const bad = "<webxr-ops>\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"x\",\"value\":{\"shape\":\"hexagono\"}}\n</webxr-ops>";
    const result = await collect(processModelStream(chunks(bad), { baseDoc: emptyDoc(), retry: async () => chunks(bad) }));
    assert.equal(result.length, 1);
    assert.match(String(result[0]), /^<assistant-response>No pude aplicar el cambio[\s\S]*shape/);
    assert.doesNotMatch(String(result[0]), /webxr-html/);
  });

  it("emite la escena al cerrar las operaciones, antes del resumen", async () => {
    let resolveSummary!: () => void;
    const summaryGate = new Promise<void>(resolve => { resolveSummary = resolve; });
    async function* slow() {
      yield ops[0]; yield ops[1]; yield ops[2];
      yield "</webxr-ops>\n";
      await summaryGate;
      yield "<assistant-response>Listo</assistant-response>";
    }
    const iterator = processModelStream(slow(), { baseDoc: emptyDoc(), now: () => 0 })[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.ok(!first.done && typeof first.value !== "string" && first.value.kind === "scene");
    assert.match(first.value.html, /^<!doctype html>/);
    resolveSummary();
    const rest: ReplyChunk[] = [];
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value);
    assert.match(rest.join(""), /Listo<\/assistant-response>$/);
  });

  it("aplica lo válido y pide corregir solo la pieza inválida", async () => {
    const reasons: string[] = [];
    let summaryRead = false;
    async function* mixed() {
      yield "<webxr-ops>\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"bien\",\"value\":{\"shape\":\"box\"}}\n";
      yield "{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"mal\",\"value\":{\"shape\":\"hexagono\"}}\n</webxr-ops>";
      summaryRead = true;
      yield "<assistant-response>largo</assistant-response>";
    }
    const result = await collect(processModelStream(mixed(), {
      baseDoc: emptyDoc(),
      now: () => 0,
      retry: async (_failed, reason) => {
        reasons.push(reason);
        return chunks("<webxr-ops>\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"mal\",\"value\":{\"shape\":\"sphere\"}}\n</webxr-ops><assistant-response>Corregido</assistant-response>");
      },
    }));
    assert.equal(summaryRead, false, "no espera el resumen del intento fallido");
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /entity "mal"/);
    assert.doesNotMatch(reasons[0], /"bien"/);
    const partial = result.find(chunk => typeof chunk !== "string" && chunk.kind === "doc");
    assert.ok(partial && typeof partial !== "string" && partial.kind === "doc");
    assert.equal(partial.doc.entities.bien.shape, "box", "lo válido se ve mientras llega la corrección");
    const doc = extractBaseDoc(result.filter(chunk => typeof chunk === "string").join(""));
    assert.equal(doc?.entities.bien.shape, "box");
    assert.equal(doc?.entities.mal.shape, "sphere");
  });

  it("sin corrección disponible, descarta la pieza inválida y entrega el resto", async () => {
    const raw = "<webxr-ops>\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"bien\",\"value\":{\"shape\":\"box\"}}\n{\"op\":\"set\",\"kind\":\"entity\",\"id\":\"mal\",\"value\":{\"shape\":\"hexagono\"}}\n</webxr-ops><assistant-response>ok</assistant-response>";
    const result = await collect(processModelStream(chunks(raw), { baseDoc: emptyDoc() }));
    const doc = extractBaseDoc(result.filter(chunk => typeof chunk === "string").join(""));
    assert.equal(doc?.entities.bien.shape, "box");
    assert.equal(doc?.entities.mal, undefined);
  });
});
