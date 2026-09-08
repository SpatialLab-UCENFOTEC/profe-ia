import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("API del chatbot", () => {
  it("reporta su estado", async () => {
    const app = createApp({ generateReply: async () => "", model: "modelo-prueba" });
    const response = await request(app).get("/api/health").expect(200);
    assert.deepEqual(response.body, { ok: true, model: "modelo-prueba" });
  });

  it("envía el historial y devuelve la respuesta", async () => {
    const app = createApp({
      model: "modelo-prueba",
      generateReply: async (messages) => `Recibí: ${messages.at(-1)?.content}`,
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "Hola" }] })
      .expect(200);
    assert.equal(response.body.reply, "Recibí: Hola");
  });

  it("rechaza historiales inválidos", async () => {
    const app = createApp({ generateReply: async () => "", model: "modelo-prueba" });
    await request(app).post("/api/chat").send({ messages: [] }).expect(400);
    await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "model", content: "Sin pregunta" }] })
      .expect(400);
  });

  it("oculta errores internos del proveedor", async () => {
    const app = createApp({
      model: "modelo-prueba",
      generateReply: async () => {
        throw new Error("secreto interno");
      },
    });
    const response = await request(app)
      .post("/api/chat")
      .send({ messages: [{ role: "user", content: "Hola" }] })
      .expect(502);
    assert.doesNotMatch(response.body.error, /secreto interno/);
  });
});
