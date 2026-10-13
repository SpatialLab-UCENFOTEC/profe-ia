import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMessage, extractBaseDocument, isBaseHello, isBaseHtml } from "../src/baseFrame";

const BASE = `<!doctype html><html><head></head><body><script type="application/json" id="profeia-base-doc">{"version":2,"ui":{"t":{"type":"text","text":"\\u003c/script>"}}}</script><script>/* runtime */</script></body></html>`;

describe("protocolo de la base", () => {
  it("reconoce la base y recupera su documento con texto escapado", () => {
    assert.equal(isBaseHtml(BASE), true);
    assert.equal(isBaseHtml("<!doctype html><html><body></body></html>"), false);
    const doc = extractBaseDocument(BASE) as { ui: { t: { text: string } } };
    assert.equal(doc.ui.t.text, "</script>");
  });

  it("no inventa un documento si el JSON está roto o falta", () => {
    assert.equal(extractBaseDocument(BASE.replace('{"version"', '{"version"x')), undefined);
    assert.equal(extractBaseDocument("<html></html>"), undefined);
  });

  it("arma el mensaje de aplicación y reconoce el saludo", () => {
    assert.deepEqual(applyMessage({ version: 2 }, { draft: true }), { namespace: "profeia-base", type: "apply", doc: { version: 2 }, runId: undefined, draft: true });
    assert.equal(isBaseHello({ namespace: "profeia-base", type: "hello", version: 1 }), true);
    assert.equal(isBaseHello({ namespace: "profeia-preview", type: "hello" }), false);
    assert.equal(isBaseHello(null), false);
  });
});
