import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp, parseApiTokens } from "../src/app.js";

const ACCESS_PASSWORD = "contraseña-de-prueba";
const API_TOKEN = "token-de-prueba-con-mas-de-32-caracteres";
const PROVIDERS = [
  { id: "falso", label: "Falso", model: "modelo-prueba" },
  { id: "otro", label: "Otro", model: "modelo-2" },
];

async function* chunks(...values: string[]) {
  for (const value of values) yield value;
}

function eventsFrom(responseText: string) {
  return responseText.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
}

function testApp(generateReply: Parameters<typeof createApp>[0]["generateReply"] = async () => chunks("ok")) {
  return createApp({
    generateReply,
    providers: PROVIDERS,
    defaultProvider: "falso",
    accessPassword: ACCESS_PASSWORD,
    apiTokens: parseApiTokens(`pruebas:${API_TOKEN}`),
  });
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
    assert.deepEqual(response.body, { ok: true, defaultProvider: "falso", providers: ["falso", "otro"] });
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
      { type: "final", text: "Recibí: Hola con 13 caracteres", provider: "falso" },
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

  it("avisa que se está aplicando un parche sin incluirlo en la respuesta final", async () => {
    async function* patchedStream() {
      yield { phase: "patching" as const };
      yield "<assistant-response>Cambié el cielo</assistant-response>";
    }
    const app = testApp(async () => patchedStream());
    const agent = await authenticatedAgent(app);
    const response = await agent.post("/api/chat").send({ messages: [{ role: "user", content: "Cambia el cielo" }] }).expect(200);
    const events = eventsFrom(response.text);

    assert.deepEqual(events[0], { type: "status", phase: "patching" });
    assert.deepEqual(events[1], { type: "delta", text: "<assistant-response>Cambié el cielo</assistant-response>" });
    assert.equal(events[2]?.type, "final");
    assert.doesNotMatch(String(events[2]?.text), /patching/);
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
});

describe("Acceso por token de API", () => {
  const body = { messages: [{ role: "user", content: "Hola" }] };

  it("acepta un token Bearer válido sin sesión", async () => {
    const app = testApp(async () => chunks("<assistant-response>Hola</assistant-response>"));
    const response = await request(app).post("/api/chat").set("Authorization", `Bearer ${API_TOKEN}`).send(body).expect(200);
    assert.equal(eventsFrom(response.text).at(-1)?.type, "done");
  });

  it("rechaza tokens inválidos o ausentes", async () => {
    const app = testApp();
    const invalid = await request(app).post("/api/chat").set("Authorization", "Bearer otro-token").send(body).expect(401);
    assert.match(String(invalid.headers["www-authenticate"]), /invalid_token/);
    await request(app).post("/api/chat").send(body).expect(401);
  });

  it("limita los intentos con tokens inválidos", async () => {
    const app = testApp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app).post("/api/chat").set("Authorization", "Bearer malo").send(body).expect(401);
    }
    await request(app).post("/api/chat").set("Authorization", `Bearer ${API_TOKEN}`).send(body).expect(429);
  });

  it("devuelve JSON completo con stream=false", async () => {
    const document = "<!doctype html><html><head></head><body>XR</body></html>";
    const app = testApp(async () => chunks(`<webxr-html>${document}</webxr-html>`, "<assistant-response>Listo</assistant-response>"));
    const response = await request(app)
      .post("/api/chat?stream=false")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .send(body)
      .expect(200)
      .expect("Content-Type", /application\/json/);
    assert.equal(response.body.response, "Listo");
    assert.match(response.body.html, /^<!doctype html>/);
    assert.match(response.body.html, /profeia-preview-monitor/);
    assert.match(response.body.raw, /<assistant-response>Listo<\/assistant-response>/);
  });

  it("acepta \"model\" como alias de \"assistant\"", async () => {
    let received: string[] = [];
    const app = testApp(async (messages) => {
      received = messages.map((message) => message.role);
      return chunks("ok");
    });
    await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${API_TOKEN}`)
      .send({ messages: [{ role: "user", content: "a" }, { role: "model", content: "b" }, { role: "user", content: "c" }] })
      .expect(200);
    assert.deepEqual(received.slice(0, 3), ["user", "assistant", "user"]);
  });

  it("valida el formato de API_TOKENS", () => {
    assert.deepEqual(parseApiTokens(undefined), []);
    assert.throws(() => parseApiTokens("sin-separador"), /nombre:token/);
    assert.throws(() => parseApiTokens("corto:abc"), /32 caracteres/);
    assert.throws(() => parseApiTokens(`a:${API_TOKEN},a:${API_TOKEN}x`), /repetido/);
  });

  it("solo envía CORS a los orígenes configurados", async () => {
    const app = createApp({
      generateReply: async () => chunks("ok"),
      providers: PROVIDERS,
      defaultProvider: "falso",
      accessPassword: ACCESS_PASSWORD,
      corsOrigins: ["https://permitido.example"],
    });
    const allowed = await request(app).options("/api/chat").set("Origin", "https://permitido.example").expect(204);
    assert.equal(allowed.headers["access-control-allow-origin"], "https://permitido.example");
    const other = await request(app).options("/api/chat").set("Origin", "https://otro.example").expect(204);
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  });
});

describe("Varios proveedores de LLM", () => {
  const body = { messages: [{ role: "user", content: "Hola" }] };

  it("usa el predeterminado o el proveedor pedido y lo informa", async () => {
    const used: (string | undefined)[] = [];
    const app = testApp(async (_messages, _html, options) => {
      used.push(options?.provider);
      return chunks("<assistant-response>ok</assistant-response>");
    });
    const auth = { Authorization: `Bearer ${API_TOKEN}` };
    const byDefault = await request(app).post("/api/chat?stream=false").set(auth).send(body).expect(200);
    const chosen = await request(app).post("/api/chat?stream=false").set(auth).send({ ...body, provider: "otro" }).expect(200);
    assert.deepEqual(used, ["falso", "otro"]);
    assert.equal(byDefault.body.provider, "falso");
    assert.equal(chosen.body.provider, "otro");
  });

  it("rechaza proveedores desconocidos", async () => {
    const app = testApp();
    const response = await request(app).post("/api/chat").set("Authorization", `Bearer ${API_TOKEN}`).send({ ...body, provider: "inexistente" }).expect(400);
    assert.match(response.body.error, /falso, otro/);
  });

  it("lista los proveedores solo a clientes autenticados", async () => {
    const app = testApp();
    await request(app).get("/api/providers").expect(401);
    const response = await request(app).get("/api/providers").set("Authorization", `Bearer ${API_TOKEN}`).expect(200);
    assert.deepEqual(response.body, { default: "falso", providers: PROVIDERS });
  });
});
