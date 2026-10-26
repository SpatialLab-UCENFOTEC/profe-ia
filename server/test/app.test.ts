import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp, ensureAssistantResponse } from "../src/app.js";
import { emptyDoc } from "../src/base/schema.js";

const ACCESS_PASSWORD = "contraseña-de-prueba";

async function* chunks(...values: Array<string | { kind: "doc"; doc: ReturnType<typeof emptyDoc> }>) {
  for (const value of values) yield value;
}

function eventsFrom(responseText: string) {
  return responseText.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

type AppOptions = Parameters<typeof createApp>[0];

function testApp(
  generateReply: AppOptions["generateReply"] = async () => chunks("ok"),
  options: Partial<AppOptions> = {},
) {
  return createApp({ generateReply, model: "modelo-prueba", accessPassword: ACCESS_PASSWORD, ...options });
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
      { type: "final", text: "<assistant-response>Recibí: Hola con 13 caracteres</assistant-response>" },
      { type: "done" },
    ]);
  });

  it("mantiene el streaming visual sin ejecutar HTML hasta enviar la versión instrumentada", async () => {
    const document = "<!doctype html><html><head></head><body><main>XR</main></body></html>";
    const rawResponse = `<webxr-html>${document}</webxr-html><assistant-response>Listo</assistant-response>`;
    const app = testApp(async () => chunks(rawResponse.slice(0, 45), rawResponse.slice(45)));
    const agent = await authenticatedAgent(app);
    const response = await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Crea XR" }] }).expect(200);
    const events = eventsFrom(response.text);

    assert.equal(events[0]?.type, "delta");
    assert.equal(events[1]?.type, "delta");
    assert.doesNotMatch(String(events[0]?.text) + String(events[1]?.text), /profeia-preview-monitor/);
    assert.equal(events[2]?.type, "final");
    assert.match(String(events[2]?.text), /profeia-preview-monitor/);
    assert.deepEqual(events[3], { type: "done" });
  });

  it("manda los documentos intermedios de la base como eventos doc", async () => {
    const doc = emptyDoc();
    const app = testApp(async () => chunks({ kind: "doc", doc }, "<assistant-response>Listo</assistant-response>"));
    const agent = await authenticatedAgent(app);
    const response = await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Hola" }] }).expect(200);
    assert.deepEqual(eventsFrom(response.text), [
      { type: "doc", doc },
      { type: "delta", text: "<assistant-response>Listo</assistant-response>" },
      { type: "final", text: "<assistant-response>Listo</assistant-response>" },
      { type: "done" },
    ]);
  });

  it("entrega la escena vacía instrumentada solo con sesión", async () => {
    const app = testApp();
    await request(app).get("/api/chat/base").expect(401);
    const agent = await authenticatedAgent(app);
    const response = await agent.get("/api/chat/base").expect(200).expect("Content-Type", /text\/html/);
    assert.match(response.text, /profeia-preview-monitor/);
    assert.match(response.text, /id="profeia-base-doc"/);
    assert.ok(response.text.indexOf("profeia-preview-monitor") < response.text.indexOf("ProfeIA base runtime"));
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

  it("emite un error seguro si el proveedor falla durante el streaming", async () => {
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

  it("cuenta los intentos de login por la IP real del cliente detrás del proxy", async () => {
    const app = testApp(undefined, { clientIpHeader: "X-Real-IP" });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app).post("/api/auth/login").set("X-Real-IP", "203.0.113.7").send({ password: "mala" }).expect(401);
    }
    await request(app).post("/api/auth/login").set("X-Real-IP", "203.0.113.7").send({ password: ACCESS_PASSWORD }).expect(429);
    await request(app).post("/api/auth/login").set("X-Real-IP", "198.51.100.9").send({ password: ACCESS_PASSWORD }).expect(200);
  });

  it("ignora el header de IP si no está configurado", async () => {
    const app = testApp();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app).post("/api/auth/login").set("X-Real-IP", `203.0.113.${attempt}`).send({ password: "mala" }).expect(401);
    }
    await request(app).post("/api/auth/login").set("X-Real-IP", "198.51.100.9").send({ password: ACCESS_PASSWORD }).expect(429);
  });

  it("limita las solicitudes de chat por sesión sin llamar al modelo", async () => {
    let calls = 0;
    const app = testApp(async () => { calls += 1; return chunks("<assistant-response>ok</assistant-response>"); }, { chatRequestsPerSession: 2 });
    const agent = await authenticatedAgent(app);
    const other = await authenticatedAgent(app);
    const body = { messages: [{ role: "user", content: "Hola" }] };
    await agent.post("/api/chat").send(body).expect(200);
    await agent.post("/api/chat").send(body).expect(200);
    const blocked = await agent.post("/api/chat").send(body).expect(429);
    assert.ok(Number(blocked.headers["retry-after"]) > 0);
    await other.post("/api/chat").send(body).expect(200);
    assert.equal(calls, 3);
  });

  it("aplica un techo global de solicitudes de chat", async () => {
    let calls = 0;
    const app = testApp(async () => { calls += 1; return chunks("<assistant-response>ok</assistant-response>"); }, { chatRequestsPerHour: 2 });
    const body = { messages: [{ role: "user", content: "Hola" }] };
    await (await authenticatedAgent(app)).post("/api/chat").send(body).expect(200);
    await (await authenticatedAgent(app)).post("/api/chat").send(body).expect(200);
    const response = await (await authenticatedAgent(app)).post("/api/chat").send(body).expect(429);
    assert.match(response.body.error, /límite de uso/);
    assert.equal(calls, 2);
  });
});

describe("resumen de la respuesta", () => {
  const scene = "<webxr-html><!doctype html><html></html></webxr-html>\n";

  it("deja intacto un resumen bien formado", () => {
    const value = `${scene}<assistant-response>Listo</assistant-response>`;
    assert.equal(ensureAssistantResponse(value), value);
  });

  it("cierra un resumen cortado sin llamar al modelo", () => {
    assert.equal(ensureAssistantResponse(`${scene}<assistant-response>Agregué el cubo`), `${scene.trimEnd()}\n<assistant-response>Agregué el cubo</assistant-response>`);
  });

  it("usa uno por defecto si falta o viene vacío o repetido", () => {
    for (const tail of ["", "<assistant-response></assistant-response>", "<assistant-response>a</assistant-response><assistant-response>b</assistant-response>"]) {
      const fixed = ensureAssistantResponse(`${scene}${tail}`);
      assert.match(fixed, /<\/webxr-html>\n<assistant-response>.+<\/assistant-response>$/);
      assert.equal(fixed.split("<assistant-response>").length, 2);
    }
  });
});
