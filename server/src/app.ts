import express, { type ErrorRequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { ChatMessage, GenerateReply, ProviderInfo, ReplyChunk } from "./types.js";
import { instrumentGeneratedResponse } from "./previewMonitor.js";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_HTML_LENGTH = 250_000;
const SESSION_COOKIE = "profeia_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_TOKEN_FAILURES = 10;
const MIN_TOKEN_LENGTH = 32;

interface Session {
  expiresAt: number;
}

interface LoginAttempts {
  count: number;
  resetAt: number;
}

/** Cliente externo autorizado a usar la API con un token Bearer. */
export interface ApiToken {
  name: string;
  hash: Buffer;
}

/**
 * Lee API_TOKENS con el formato `nombre:token,otro:token2`.
 * Cada token debe tener al menos 32 caracteres; solo se conserva su hash.
 */
export function parseApiTokens(raw: string | undefined): ApiToken[] {
  if (!raw?.trim()) return [];
  const tokens: ApiToken[] = [];
  for (const entry of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.indexOf(":");
    const name = separator > 0 ? entry.slice(0, separator).trim() : "";
    const token = separator > 0 ? entry.slice(separator + 1).trim() : "";
    if (!/^[\w.-]+$/.test(name)) {
      throw new Error("API_TOKENS: cada entrada debe tener el formato nombre:token (nombre con letras, números, \"_\", \"-\" o \".\").");
    }
    if (token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`API_TOKENS: el token de "${name}" debe tener al menos ${MIN_TOKEN_LENGTH} caracteres.`);
    }
    if (tokens.some((item) => item.name === name)) {
      throw new Error(`API_TOKENS: el nombre "${name}" está repetido.`);
    }
    tokens.push({ name, hash: hash(token) });
  }
  return tokens;
}

function findApiClient(candidate: string, tokens: ApiToken[]) {
  const candidateHash = hash(candidate);
  let match: ApiToken | undefined;
  // Recorre todos los tokens sin cortar antes para no filtrar información por tiempo.
  for (const token of tokens) {
    if (timingSafeEqual(candidateHash, token.hash) && !match) match = token;
  }
  return match;
}

function bearerToken(header: string | undefined) {
  return header?.match(/^Bearer\s+(.+)$/i)?.[1].trim();
}

function createAttemptLimiter(maxAttempts: number) {
  const attempts = new Map<string, LoginAttempts>();
  return {
    retryAfter(key: string, now = Date.now()) {
      const current = attempts.get(key);
      return current && current.resetAt > now && current.count >= maxAttempts ? Math.ceil((current.resetAt - now) / 1000) : 0;
    },
    fail(key: string, now = Date.now()) {
      const previous = attempts.get(key);
      const current = previous && previous.resetAt > now ? previous : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      current.count += 1;
      attempts.set(key, current);
    },
    reset(key: string) {
      attempts.delete(key);
    },
  };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest();
}

function passwordsMatch(candidate: string, expected: string) {
  return timingSafeEqual(hash(candidate), hash(expected));
}

function cookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    return null;
  }

  const messages: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { role: rawRole, content } = item as Record<string, unknown>;
    // "model" se acepta como alias histórico de "assistant".
    const role = rawRole === "model" ? "assistant" : rawRole;
    if (
      (role !== "user" && role !== "assistant") ||
      typeof content !== "string" ||
      content.trim().length === 0 ||
      content.length > MAX_MESSAGE_LENGTH
    ) {
      return null;
    }
    messages.push({ role, content: content.trim() });
  }

  if (messages.at(-1)?.role !== "user") return null;
  return messages;
}

function parseCurrentHtml(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > MAX_HTML_LENGTH) return null;
  return value;
}

function streamEvent(type: "delta" | "status" | "final" | "done" | "error", payload: Record<string, unknown> = {}) {
  return `${JSON.stringify({ type, ...payload })}\n`;
}

function hasValidAssistantResponse(value: string) {
  const matches = [...value.matchAll(/<assistant-response>([\s\S]*?)<\/assistant-response>/gi)];
  return matches.length === 1 && Boolean(matches[0][1].trim()) &&
    value.split("<assistant-response>").length === 2 && value.split("</assistant-response>").length === 2;
}

function extractAssistantResponse(value: string) {
  return value.match(/<assistant-response>[\s\S]*?<\/assistant-response>/i)?.[0] ?? "";
}

function blockContent(value: string, tag: "assistant-response" | "webxr-html") {
  return value.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1].trim();
}

export interface AppOptions {
  generateReply: GenerateReply;
  /** Proveedores de LLM configurados; el cliente puede elegir uno por petición. */
  providers: ProviderInfo[];
  /** Id del proveedor que se usa cuando la petición no indica ninguno. */
  defaultProvider: string;
  accessPassword: string;
  /** Tokens Bearer para clientes externos (ver docs/api.md). */
  apiTokens?: ApiToken[];
  /** Orígenes de navegador autorizados a llamar a la API (CORS). */
  corsOrigins?: string[];
  clientDist?: string;
}

export function createApp({ generateReply, providers, defaultProvider, accessPassword, apiTokens = [], corsOrigins = [], clientDist }: AppOptions) {
  const providerIds = new Set(providers.map((provider) => provider.id));
  const app = express();
  const sessions = new Map<string, Session>();
  const loginLimiter = createAttemptLimiter(MAX_LOGIN_ATTEMPTS);
  const tokenLimiter = createAttemptLimiter(MAX_TOKEN_FAILURES);
  app.disable("x-powered-by");

  if (corsOrigins.length > 0) {
    app.use("/api", (request, response, next) => {
      const origin = request.headers.origin;
      if (origin && corsOrigins.includes(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.setHeader("Access-Control-Max-Age", "600");
      }
      response.append("Vary", "Origin");
      if (request.method === "OPTIONS") {
        response.status(204).end();
        return;
      }
      next();
    });
  }

  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, defaultProvider, providers: providers.map((provider) => provider.id) });
  });

  const getSession = (request: express.Request) => {
    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    if (!token) return undefined;
    const session = sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return undefined;
    }
    return session;
  };

  app.get("/api/auth/status", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ authenticated: Boolean(getSession(request)) });
  });

  app.post("/api/auth/login", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const clientKey = request.ip || "unknown";
    const now = Date.now();
    const retryAfter = loginLimiter.retryAfter(clientKey, now);
    if (retryAfter) {
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({ error: "Demasiados intentos. Espera unos minutos antes de volver a intentar." });
      return;
    }

    const password = request.body?.password;
    if (typeof password !== "string" || !passwordsMatch(password, accessPassword)) {
      loginLimiter.fail(clientKey, now);
      response.status(401).json({ error: "Contraseña incorrecta." });
      return;
    }

    loginLimiter.reset(clientKey);
    const token = randomBytes(32).toString("base64url");
    sessions.set(token, { expiresAt: now + SESSION_DURATION_MS });
    response.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    response.json({ authenticated: true });
  });

  app.post("/api/auth/logout", (request, response) => {
    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    if (token) sessions.delete(token);
    response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
    response.setHeader("Cache-Control", "no-store");
    response.status(204).end();
  });

  /** Acepta un token Bearer de API_TOKENS o la cookie de sesión del frontend. */
  const requireAuth: express.RequestHandler = (request, response, next) => {
    const token = bearerToken(request.headers.authorization);
    if (token !== undefined) {
      const clientKey = request.ip || "unknown";
      const retryAfter = tokenLimiter.retryAfter(clientKey);
      if (retryAfter) {
        response.setHeader("Retry-After", String(retryAfter));
        response.status(429).json({ error: "Demasiados intentos con un token inválido. Espera unos minutos." });
        return;
      }
      const client = findApiClient(token, apiTokens);
      if (!client) {
        tokenLimiter.fail(clientKey);
        response.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
        response.status(401).json({ error: "Token de API inválido." });
        return;
      }
      tokenLimiter.reset(clientKey);
      response.locals.client = client.name;
      next();
      return;
    }
    if (getSession(request)) {
      response.locals.client = "web";
      next();
      return;
    }
    response.setHeader("WWW-Authenticate", "Bearer");
    response.status(401).json({ error: "Se requiere un token de API (Authorization: Bearer) o iniciar sesión con la contraseña." });
  };

  app.use("/api/chat", requireAuth);
  app.use("/api/providers", requireAuth);

  app.get("/api/providers", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ default: defaultProvider, providers });
  });

  /** Si el modelo omitió el bloque <assistant-response>, pide solo el resumen. */
  const missingSummary = async (messages: ChatMessage[], completedResponse: string, currentHtml: string | undefined, provider: string) => {
    if (hasValidAssistantResponse(completedResponse)) return "";
    const summaryMessages: ChatMessage[] = [
      ...messages.slice(-1),
      { role: "assistant", content: completedResponse },
      {
        role: "user",
        content: "Tu respuesta anterior no incluyó un bloque <assistant-response> válido y completo con un resumen no vacío. Conserva exactamente la experiencia ya generada; no la vuelvas a generar ni la modifiques. Devuelve únicamente este formato, con un resumen breve que explique qué se creó o cambió, cómo interactuar con la experiencia y los requisitos relevantes: <assistant-response>resumen en Markdown</assistant-response>.",
      },
    ];
    const summaryStream = await generateReply(summaryMessages, currentHtml, { provider });
    let summaryText = "";
    for await (const chunk of summaryStream) if (typeof chunk === "string") summaryText += chunk;
    const summaryBlock = extractAssistantResponse(summaryText);
    return hasValidAssistantResponse(summaryBlock) ? `\n${summaryBlock}` : "";
  };

  app.post("/api/chat", async (request, response, next) => {
    const messages = parseMessages(request.body?.messages);
    const currentHtml = parseCurrentHtml(request.body?.currentHtml);
    if (!messages || currentHtml === null) {
      response.status(400).json({
        error: `Se requiere un historial de 1 a ${MAX_MESSAGES} mensajes válidos, debe terminar con un mensaje del usuario y el HTML actual no puede superar ${MAX_HTML_LENGTH} caracteres.`,
      });
      return;
    }

    const requestedProvider = request.body?.provider;
    if (requestedProvider !== undefined && requestedProvider !== null && requestedProvider !== "" &&
      (typeof requestedProvider !== "string" || !providerIds.has(requestedProvider))) {
      response.status(400).json({ error: `Proveedor desconocido. Opciones: ${[...providerIds].join(", ")}.` });
      return;
    }
    const provider = typeof requestedProvider === "string" && requestedProvider ? requestedProvider : defaultProvider;
    const wantsStream = request.query.stream !== "false";

    try {
      const stream = await generateReply(messages, currentHtml, { provider });
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done || first.value === "") {
        throw new Error("El modelo devolvió una respuesta vacía.");
      }

      if (!wantsStream) {
        let completedResponse = typeof first.value === "string" ? first.value : "";
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          if (typeof result.value === "string") completedResponse += result.value;
        }
        completedResponse += await missingSummary(messages, completedResponse, currentHtml, provider);
        const finalResponse = instrumentGeneratedResponse(completedResponse);
        response.setHeader("Cache-Control", "no-store");
        response.json({
          response: blockContent(finalResponse, "assistant-response") ?? "",
          html: blockContent(finalResponse, "webxr-html") ?? null,
          raw: finalResponse,
          provider,
        });
        return;
      }

      response.status(200);
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.flushHeaders();

      let completedResponse = "";
      const writeChunk = (chunk: ReplyChunk) => {
        if (typeof chunk !== "string") {
          response.write(streamEvent("status", { phase: chunk.phase }));
          return;
        }
        completedResponse += chunk;
        response.write(streamEvent("delta", { text: chunk }));
      };
      writeChunk(first.value);
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          writeChunk(result.value);
        }

        const summary = await missingSummary(messages, completedResponse, currentHtml, provider);
        if (summary) {
          completedResponse += summary;
          response.write(streamEvent("delta", { text: summary }));
        }

        const instrumentedResponse = instrumentGeneratedResponse(completedResponse);
        response.write(streamEvent("final", { text: instrumentedResponse, provider }));
        response.write(streamEvent("done"));
      } catch (error) {
        console.error(`Error durante la respuesta incremental (cliente: ${response.locals.client}, proveedor: ${provider}):`, error);
        response.write(streamEvent("error", {
          message: "La generación se interrumpió. Se restauró la última versión completa.",
        }));
      } finally {
        response.end();
      }
    } catch (error) {
      next(error);
    }
  });

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (_request, response) => {
      response.sendFile(path.join(clientDist, "index.html"));
    });
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error(`Error al procesar la solicitud (cliente: ${response.locals.client ?? "?"}):`, error);
    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(502).json({
      error: "No se pudo obtener una respuesta del modelo de lenguaje. Inténtalo de nuevo en unos momentos.",
    });
  };
  app.use(errorHandler);

  return app;
}
