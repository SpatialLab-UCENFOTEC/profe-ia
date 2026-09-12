import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

const ACCESS_PASSWORD = "contraseña-de-prueba";

async function* chunks(...values: string[]) {
  for (const value of values) yield value;
}

function eventsFrom(responseText: string) {
  return responseText.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

function testApp(generateReply: Parameters<typeof createApp>[0]["generateReply"] = async () => chunks("ok")) {
  return createApp({ generateReply, model: "modelo-prueba", accessPassword: ACCESS_PASSWORD });
}

async function authenticatedAgent(app: ReturnType<typeof createApp>) {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ password: ACCESS_PASSWORD }).expect(200);
  return agent;
}

describe("API del asistente WebXR", () => {
  it("reporta su estado", async () => {
    const app = testApp();
    const response = await request(app).get("/api/health").expect(200);
    assert.deepEqual(response.body, { ok: true, model: "modelo-prueba" });
  });

  it("bloquea el chat hasta ingresar la contraseña correcta", async () => {
    const app = testApp();
    await request(app).get("/api/auth/status").expect(200, { authenticated: false });
    await request(app).post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(401);
    await request(app).post("/api/auth/login").send({ password: "incorrecta" }).expect(401);

    const agent = await authenticatedAgent(app);
    await agent.get("/api/auth/status").expect(200, { authenticated: true });
    await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(200);
  });

  it("transmite deltas y finalización en NDJSON", async () => {
    const app = testApp(async (messages, currentHtml) => chunks(
        `Recibí: ${messages.at(-1)?.content}`,
        ` con ${currentHtml?.length} caracteres`,
      ));
    const agent = await authenticatedAgent(app);
    const response = await agent
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
    const app = testApp();
    const agent = await authenticatedAgent(app);
    await agent.post("/api/chat").send({ messages: [] }).expect(400);
    await agent.post("/api/chat").send({ messages: [{ role: "model", content: "Sin pregunta" }] }).expect(400);
    await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }], currentHtml: 42 }).expect(400);
  });

  it("oculta errores internos antes de iniciar el stream", async () => {
    const app = testApp(async () => { throw new Error("secreto interno"); });
    const agent = await authenticatedAgent(app);
    const response = await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(502);
    assert.doesNotMatch(response.body.error, /secreto interno/);
  });

  it("emite un evento seguro si el proveedor falla durante el stream", async () => {
    async function* interruptedStream() {
      yield "inicio";
      throw new Error("secreto durante stream");
    }
    const app = testApp(async () => interruptedStream());
    const agent = await authenticatedAgent(app);
    const response = await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(200);
    const events = eventsFrom(response.text);
    assert.deepEqual(events[0], { type: "delta", text: "inicio" });
    assert.equal(events[1]?.type, "error");
    assert.doesNotMatch(String(events[1]?.message), /secreto/);
  });

  it("trata una respuesta vacía como error previo al stream", async () => {
    const app = testApp(async () => chunks());
    const agent = await authenticatedAgent(app);
    await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(502);
  });
});
