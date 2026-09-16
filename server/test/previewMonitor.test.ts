import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ensurePreviewMonitor, instrumentGeneratedResponse, PREVIEW_RUN_ID_PLACEHOLDER, stripPreviewMonitor } from "../src/previewMonitor.js";

describe("monitor de la vista previa", () => {
  it("se inserta al inicio del head", () => {
    const html = "<!doctype html><html><head><script>app()</script></head><body></body></html>";
    const monitored = ensurePreviewMonitor(html);
    assert.match(monitored, /profeia-preview-monitor/);
    assert.match(monitored, new RegExp(PREVIEW_RUN_ID_PLACEHOLDER));
    assert.ok(monitored.indexOf("profeia-preview-monitor") < monitored.indexOf("<script>app()"));
  });

  it("no duplica el monitor", () => {
    const html = "<!doctype html><html><head></head><body></body></html>";
    const once = ensurePreviewMonitor(html);
    assert.equal(ensurePreviewMonitor(once), once);
  });

  it("reemplaza una copia alterada y permite retirar la instrumentación", () => {
    const html = "<!doctype html><html><head><script id=\"profeia-preview-monitor\">alterado()</script></head><body></body></html>";
    const monitored = ensurePreviewMonitor(html);
    assert.doesNotMatch(monitored, /alterado/);
    assert.match(monitored, /unhandledrejection/);
    assert.doesNotMatch(stripPreviewMonitor(monitored), /profeia-preview-monitor/);
  });

  it("instrumenta solo el documento dentro de webxr-html", () => {
    const response = "<webxr-html><!doctype html><html><head></head><body></body></html></webxr-html><assistant-response>Listo</assistant-response>";
    const result = instrumentGeneratedResponse(response);
    assert.match(result, /<webxr-html>[\s\S]*profeia-preview-monitor[\s\S]*<\/webxr-html>/);
    assert.match(result, /<assistant-response>Listo<\/assistant-response>$/);
  });
});
