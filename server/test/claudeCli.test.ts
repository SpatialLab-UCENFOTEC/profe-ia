import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStreamJsonLine, serializeConversation } from "../src/llm/claudeCli.js";

describe("Adaptador Claude CLI", () => {
  it("extrae solo los deltas de texto del stream-json", () => {
    const delta = JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hola" } } });
    assert.deepEqual(parseStreamJsonLine(delta), { type: "text", text: "Hola" });
    assert.equal(parseStreamJsonLine(JSON.stringify({ type: "stream_event", event: { type: "message_start" } })), null);
    assert.equal(parseStreamJsonLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hola" }] } })), null);
    assert.equal(parseStreamJsonLine(JSON.stringify({ type: "result", is_error: false, result: "Hola" })), null);
    assert.equal(parseStreamJsonLine("no es json"), null);
  });

  it("convierte un resultado con error en un evento de error", () => {
    const event = parseStreamJsonLine(JSON.stringify({ type: "result", subtype: "error_during_execution", is_error: true, result: "Not logged in" }));
    assert.equal(event?.type, "error");
    assert.match(event?.type === "error" ? event.message : "", /Not logged in/);
  });

  it("envía un único mensaje sin envoltorio y serializa el historial", () => {
    assert.equal(serializeConversation([{ role: "user", content: "Hola" }]), "Hola");
    const prompt = serializeConversation([
      { role: "user", content: "Crea un cubo" },
      { role: "assistant", content: "<assistant-response>Listo</assistant-response>" },
      { role: "user", content: "Hazlo rojo" },
    ]);
    assert.match(prompt, /<turn role="user">\nCrea un cubo\n<\/turn>/);
    assert.match(prompt, /<turn role="assistant">/);
    assert.ok(prompt.trimEnd().endsWith("Hazlo rojo"));
  });
});
