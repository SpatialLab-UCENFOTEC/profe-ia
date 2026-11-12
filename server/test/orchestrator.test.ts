import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmProvider, StreamTextRequest } from "../src/llm/types.js";
import { createGenerator } from "../src/orchestrator.js";
import type { ReplyChunk } from "../src/types.js";

function fakeProvider(...responses: string[][]) {
  const calls: StreamTextRequest[] = [];
  const provider: LlmProvider = {
    id: "falso",
    label: "Falso",
    model: "modelo",
    async *streamText(request) {
      calls.push(request);
      for (const text of responses[calls.length - 1] ?? []) yield text;
    },
  };
  return { provider, calls };
}

async function collect(stream: AsyncIterable<ReplyChunk>) {
  const chunks: ReplyChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const scene = JSON.stringify({ version: 1, title: "Cubo", instructions: "Mira", objects: [{ id: "a", shape: "box", position: [0, 1, -3] }] });

describe("Orquestador independiente del proveedor", () => {
  it("transmite texto libre tal cual y usa el prompt de sistema", async () => {
    const { provider, calls } = fakeProvider(["<assistant-response>", "Hola</assistant-response>"]);
    const generate = createGenerator(() => provider);
    const chunks = await collect(await generate([{ role: "user", content: "Hola" }]));
    assert.equal(chunks.join(""), "<assistant-response>Hola</assistant-response>");
    assert.match(calls[0].system, /Orbit XR/);
    assert.deepEqual(calls[0].messages, [{ role: "user", content: "Hola" }]);
  });

  it("anexa la experiencia vigente sin modificar el historial original", async () => {
    const { provider, calls } = fakeProvider(["<assistant-response>ok</assistant-response>"]);
    const history = [{ role: "user" as const, content: "Cambia" }];
    await collect(await createGenerator(() => provider)(history, "<!doctype html><html><body>x</body></html>"));
    assert.match(calls[0].messages[0].content, /<current-webxr-html>/);
    assert.equal(history[0].content, "Cambia");
  });

  it("compila una escena compacta a HTML", async () => {
    const { provider } = fakeProvider([`<webxr-scene>${scene}</webxr-scene><assistant-response>Cubo</assistant-response>`]);
    const chunks = await collect(await createGenerator(() => provider)([{ role: "user", content: "Cubo" }]));
    assert.equal(chunks.length, 1);
    assert.match(String(chunks[0]), /<webxr-html>[\s\S]*<a-box/);
  });

  it("pide HTML libre si el parche falla y avisa con patch-fallback", async () => {
    const { provider, calls } = fakeProvider(
      ["<webxr-patch><edit><search>no existe</search><replace>x</replace></edit></webxr-patch><assistant-response>p</assistant-response>"],
      ["<webxr-html><!doctype html><html></html></webxr-html><assistant-response>r</assistant-response>"],
    );
    const chunks = await collect(await createGenerator(() => provider)([{ role: "user", content: "Cambia" }], "<!doctype html><html><body>x</body></html>"));
    assert.deepEqual(chunks[0], { phase: "patching" });
    assert.deepEqual(chunks[1], { phase: "patch-fallback" });
    assert.match(chunks.slice(2).join(""), /<webxr-html>/);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].messages.at(-2)?.role, "assistant");
    assert.match(calls[1].messages.at(-1)?.content ?? "", /FORMATO HTML LIBRE/);
  });
});
