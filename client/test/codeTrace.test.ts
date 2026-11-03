import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diagnosticLines, diffLines } from "../src/codeTrace";
import { classifyPreviewDiagnostic } from "../src/previewDiagnostics";

const lines = (...values: string[]) => values.join("\n");

describe("diff por líneas del código fantasma", () => {
  it("no marca nada si el documento no cambia", () => {
    assert.deepEqual(diffLines(lines("a", "b", "c"), lines("a", "b", "c")), { removed: [], added: [] });
  });

  it("marca una línea reemplazada en ambos lados", () => {
    assert.deepEqual(diffLines(lines("a", "b", "c"), lines("a", "B", "c")), { removed: [1], added: [1] });
  });

  it("marca inserciones y borrados", () => {
    assert.deepEqual(diffLines(lines("a", "c"), lines("a", "b", "c")), { removed: [], added: [1] });
    assert.deepEqual(diffLines(lines("a", "b", "c"), lines("a", "c")), { removed: [1], added: [] });
  });

  it("marca varios bloques separados", () => {
    const before = lines("a", "b", "c", "d", "e", "f");
    const after = lines("a", "B", "c", "d", "E", "e2", "f");
    assert.deepEqual(diffLines(before, after), { removed: [1, 4], added: [1, 4, 5] });
  });
});

describe("líneas señaladas por diagnósticos", () => {
  it("toma solo líneas numéricas de errores fatales, sin repetir", () => {
    const withLine = classifyPreviewDiagnostic({ type: "runtime-error", details: { message: "ReferenceError: x", line: 12 } });
    const sameLine = classifyPreviewDiagnostic({ type: "runtime-error", details: { message: "TypeError: y", line: 12 } });
    const textLine = classifyPreviewDiagnostic({ type: "runtime-error", details: { message: "Error z", line: "7" } });
    const withoutLine = classifyPreviewDiagnostic({ type: "startup-timeout", details: {} });
    const ignored = classifyPreviewDiagnostic({ type: "runtime-error", details: { message: "ResizeObserver loop", line: 3 } });
    assert.deepEqual(diagnosticLines([withLine, sameLine, textLine, withoutLine, ignored]), [11]);
  });
});
