import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WebXrStreamParser, isCompleteHtmlDocument } from "../src/streamParser";

const DOCUMENT = "<!doctype html><html><head><title>XR</title></head><body><main>Hola</main></body></html>";

describe("WebXrStreamParser", () => {
  it("reconstruye etiquetas repartidas entre chunks", () => {
    const parser = new WebXrStreamParser();
    parser.push("<webxr-");
    parser.push(`html>${DOCUMENT}</webxr-html><assistant-`);
    const partial = parser.push("response>**Listo**</assistant-response>");
    assert.equal(partial.hasHtml, true);
    assert.equal(partial.htmlComplete, true);
    assert.equal(partial.hasResponse, true);
    assert.equal(partial.responseComplete, true);
    assert.deepEqual(parser.finish(), { html: DOCUMENT, response: "**Listo**" });
  });

  it("expone HTML parcial mientras llega", () => {
    const parser = new WebXrStreamParser();
    const partial = parser.push("<webxr-html><!doctype html><html><head>");
    assert.equal(partial.hasHtml, true);
    assert.equal(partial.htmlComplete, false);
    assert.match(partial.html, /doctype html/);
  });

  it("marca el HTML listo antes de que termine el resumen", () => {
    const parser = new WebXrStreamParser();
    const state = parser.push(`<webxr-html>${DOCUMENT}</webxr-html><assistant-response>Escribiendo`);
    assert.equal(state.htmlComplete, true);
    assert.equal(state.responseComplete, false);
    assert.equal(isCompleteHtmlDocument(state.html), true);
  });

  it("acepta respuestas conceptuales sin HTML", () => {
    const parser = new WebXrStreamParser();
    parser.push("<assistant-response>WebXR requiere un contexto seguro.</assistant-response>");
    assert.deepEqual(parser.finish(), { response: "WebXR requiere un contexto seguro." });
  });

  it("rechaza HTML incompleto y resúmenes incompletos", () => {
    const invalidHtml = new WebXrStreamParser();
    invalidHtml.push("<webxr-html><html></html></webxr-html><assistant-response>Resumen</assistant-response>");
    assert.throws(() => invalidHtml.finish(), /completo y válido/);
    const invalidSummary = new WebXrStreamParser();
    invalidSummary.push(`<webxr-html>${DOCUMENT}</webxr-html><assistant-response>Resumen`);
    assert.throws(() => invalidSummary.finish(), /resumen completo/);
  });

  it("valida la estructura mínima de un documento completo", () => {
    assert.equal(isCompleteHtmlDocument(DOCUMENT), true);
    assert.equal(isCompleteHtmlDocument("<html><body></body></html>"), false);
  });
});
