import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

async function* chunks(...values: string[]) {
  for (const value of values) yield value;
}

function eventsFrom(responseText: string) {
  return responseText.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("API del asistente WebXR", () => {
  it("reporta su estado", async () => {
    const app = createApp({ generateReply: async () => chunks("ok"), model: "modelo-prueba" });
    const response = await request(app).get("/api/health").expect(200);
    assert.deepEqual(response.body, { ok: true, model: "modelo-prueba" });
  });

  it("transmite deltas y finalización en NDJSON", async () => {
    const app = createApp({
      model: "modelo-prueba",
      generateReply: async (messages, currentHtml) => chunks(
        `Recibí: ${messages.at(-1)?.content}`,
        ` con ${currentHtml?.length} caracteres`,
      ),
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "Hola" }], currentHtml: "<html></html>" })
      .expect(200)
      .expect("Content-Type", /application\/x-ndjson/);

    assert.deepEqual(eventsFrom(response.text), [
      { type: "delta", text: "Recibí: Hola" },
      { type: "delta", text: " con 13 caracteres" },
      { type: "done" },
    ]);
  });

  it("rechaza historiales y HTML actual inválidos", async () => {
    const app = createApp({ generateReply: async () => chunks("ok"), model: "modelo-prueba" });
    await request(app).post("/api/chat").send({ messages: [] }).expect(400);
    await request(app).post("/api/chat").send({ messages: [{ role: "model", content: "Sin pregunta" }] }).expect(400);
    await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }], currentHtml: 42 }).expect(400);
  });

  it("oculta errores internos antes de iniciar el stream", async () => {
    const app = createApp({
      model: "modelo-prueba",
      generateReply: async () => { throw new Error("secreto interno"); },
    });
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(502);
    assert.doesNotMatch(response.body.error, /secreto interno/);
  });

  it("emite un evento seguro si el proveedor falla durante el stream", async () => {
    async function* interruptedStream() {
      yield "inicio";
      throw new Error("secreto durante stream");
    }
    const app = createApp({ model: "modelo-prueba", generateReply: async () => interruptedStream() });
    const response = await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(200);
    const events = eventsFrom(response.text);
    assert.deepEqual(events[0], { type: "delta", text: "inicio" });
    assert.equal(events[1]?.type, "error");
    assert.doesNotMatch(String(events[1]?.message), /secreto/);
  });

  it("trata una respuesta vacía como error previo al stream", async () => {
    const app = createApp({ generateReply: async () => chunks(), model: "modelo-prueba" });
    await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(502);
  });
});
