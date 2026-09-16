import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyPreviewDiagnostic, errorsPrompt } from "../src/previewDiagnostics";

describe("clasificación de errores de preview", () => {
  it("clasifica excepciones e imports fallidos como fatales", () => {
    const runtime = classifyPreviewDiagnostic({
      type: "runtime-error",
      details: { message: 'Failed to resolve module specifier "three"' },
    });
    const script = classifyPreviewDiagnostic({
      type: "resource-error",
      details: { tag: "SCRIPT", url: "https://cdn.example/missing.js" },
    });
    assert.equal(runtime.severity, "fatal");
    assert.equal(script.severity, "fatal");
  });

  it("mantiene assets visuales como advertencias y descarta ruido conocido", () => {
    assert.equal(classifyPreviewDiagnostic({ type: "resource-error", details: { tag: "IMG" } }).severity, "warning");
    assert.equal(classifyPreviewDiagnostic({ type: "runtime-error", details: { message: "ResizeObserver loop limit exceeded" } }).severity, "ignored");
  });

  it("forma el bloque reservado para autorreparación", () => {
    const fatal = classifyPreviewDiagnostic({ type: "unhandled-rejection", details: { message: "c.easing is not a function" } });
    assert.match(errorsPrompt([fatal]), /^<ERRORS>[\s\S]*c\.easing is not a function[\s\S]*<\/ERRORS>$/);
  });

  it("envía la falta de respuesta visible al mismo flujo de autorreparación", () => {
    const missingResponse = classifyPreviewDiagnostic({ type: "missing-response", details: {} });

    assert.equal(missingResponse.severity, "fatal");
    assert.match(errorsPrompt([missingResponse]), /<assistant-response> completo/);
  });
});
