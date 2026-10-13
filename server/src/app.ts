import express, { type ErrorRequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { ChatMessage, GenerateReply, ReplyChunk } from "./types.js";
import { renderBaseHtml } from "./base/render.js";
import { emptyDoc } from "./base/schema.js";
import { ensurePreviewMonitor, instrumentGeneratedResponse } from "./previewMonitor.js";
import { createRateLimiter } from "./rateLimit.js";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_HTML_LENGTH = 250_000;
const SESSION_COOKIE = "profeia_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Un aula entera suele salir a Internet por la misma IP: el límite tiene que aguantar
// varios errores de tipeo sin dejar afuera a todos.
const MAX_LOGIN_ATTEMPTS = 20;
const CHAT_SESSION_WINDOW_MS = 15 * 60 * 1000;
const CHAT_GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_CHAT_REQUESTS_PER_SESSION = 30;
export const DEFAULT_CHAT_REQUESTS_PER_HOUR = 300;

interface Session {
  expiresAt: number;
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
    const { role, content } = item as Record<string, unknown>;
    if (
      (role !== "user" && role !== "model") ||
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

function streamEvent(type: "delta" | "doc" | "final" | "done" | "error", payload: Record<string, unknown> = {}) {
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

export interface AppOptions {
  generateReply: GenerateReply;
  model: string;
  accessPassword: string;
  clientDist?: string;
  /**
   * Header con la IP real del cliente que pone el proxy de entrada (en Railway, `x-real-ip`).
   * Sin él, los límites usan la IP del socket, que detrás de un proxy es la del proxy.
   */
  clientIpHeader?: string;
  /** Solicitudes a /api/chat por sesión cada 15 minutos. */
  chatRequestsPerSession?: number;
  /** Solicitudes a /api/chat por hora sumando todas las sesiones: el techo de uso de Gemini. */
  chatRequestsPerHour?: number;
}

export function createApp({
  generateReply,
  model,
  accessPassword,
  clientDist,
  clientIpHeader,
  chatRequestsPerSession = DEFAULT_CHAT_REQUESTS_PER_SESSION,
  chatRequestsPerHour = DEFAULT_CHAT_REQUESTS_PER_HOUR,
}: AppOptions) {
  const app = express();
  const sessions = new Map<string, Session>();
  const loginLimiter = createRateLimiter(MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);
  const sessionChatLimiter = createRateLimiter(chatRequestsPerSession, CHAT_SESSION_WINDOW_MS);
  const globalChatLimiter = createRateLimiter(chatRequestsPerHour, CHAT_GLOBAL_WINDOW_MS);
  const ipHeader = clientIpHeader?.trim().toLowerCase() || undefined;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, model });
  });

  const clientIp = (request: express.Request) => {
    const forwarded = ipHeader ? request.get(ipHeader)?.split(",")[0]?.trim() : undefined;
    return forwarded || request.socket.remoteAddress || "unknown";
  };

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
    const clientKey = clientIp(request);
    const now = Date.now();
    const retryAfter = loginLimiter.retryAfter(clientKey);
    if (retryAfter > 0) {
      response.setHeader("Retry-After", String(retryAfter));
      response.status(429).json({ error: "Demasiados intentos. Espera unos minutos antes de volver a intentar." });
      return;
    }

    const password = request.body?.password;
    if (typeof password !== "string" || !passwordsMatch(password, accessPassword)) {
      loginLimiter.record(clientKey);
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

  app.use("/api/chat", (request, response, next) => {
    if (!getSession(request)) {
      response.status(401).json({ error: "Debes ingresar la contraseña para continuar." });
      return;
    }
    next();
  });

  // La escena vacía con la que arranca la vista previa; después todo llega como cambios sobre ella.
  app.get("/api/chat/base", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.type("html").send(ensurePreviewMonitor(renderBaseHtml(emptyDoc())));
  });

  app.post("/api/chat", async (request, response, next) => {
    const messages = parseMessages(request.body?.messages);
    const currentHtml = parseCurrentHtml(request.body?.currentHtml);
    if (!messages || currentHtml === null) {
      response.status(400).json({
        error: `Se requiere un historial de 1 a ${MAX_MESSAGES} mensajes válidos, debe terminar con un mensaje del usuario y el HTML actual no puede superar ${MAX_HTML_LENGTH} caracteres.`,
      });
      return;
    }

    const sessionKey = cookieValue(request.headers.cookie, SESSION_COOKIE) ?? "unknown";
    const sessionRetry = sessionChatLimiter.retryAfter(sessionKey);
    const globalRetry = globalChatLimiter.retryAfter("global");
    if (sessionRetry > 0 || globalRetry > 0) {
      response.setHeader("Retry-After", String(Math.max(sessionRetry, globalRetry)));
      response.status(429).json({
        error: globalRetry > 0
          ? "Se alcanzó el límite de uso de la herramienta por esta hora. Inténtalo de nuevo más tarde."
          : "Hiciste muchas solicitudes seguidas. Espera unos minutos antes de pedir otro cambio.",
      });
      return;
    }
    sessionChatLimiter.record(sessionKey);
    globalChatLimiter.record("global");

    try {
      const stream = await generateReply(messages, currentHtml);
      const iterator = stream[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done || !first.value) {
        throw new Error("Gemini devolvió una respuesta vacía.");
      }

      response.status(200);
      response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.flushHeaders();

      let completedResponse = "";
      // Los documentos intermedios de la base van como eventos aparte: el cliente los aplica en vivo.
      const write = (chunk: ReplyChunk) => {
        if (typeof chunk === "string") {
          completedResponse += chunk;
          response.write(streamEvent("delta", { text: chunk }));
        } else {
          response.write(streamEvent("doc", { doc: chunk.doc }));
        }
      };
      write(first.value);
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          write(result.value);
        }

        if (!hasValidAssistantResponse(completedResponse)) {
          const summaryMessages: ChatMessage[] = [
            ...messages.slice(-1),
            { role: "model", content: completedResponse.replace(/<webxr-html>[\s\S]*?<\/webxr-html>/i, "<webxr-html>(experiencia ya generada)</webxr-html>") },
            {
              role: "user",
              content: "Tu respuesta anterior no incluyó un bloque <assistant-response> válido y completo con un resumen no vacío. Conserva exactamente la experiencia ya generada; no la vuelvas a generar ni la modifiques. Devuelve únicamente este formato, con un resumen breve que explique qué se creó o cambió, cómo interactuar con la experiencia y los requisitos relevantes: <assistant-response>resumen en Markdown</assistant-response>.",
            },
          ];
          const summaryStream = await generateReply(summaryMessages, currentHtml);
          let summaryText = "";
          for await (const chunk of summaryStream) if (typeof chunk === "string") summaryText += chunk;
          const summaryBlock = extractAssistantResponse(summaryText);
          if (hasValidAssistantResponse(summaryBlock)) {
            completedResponse += `\n${summaryBlock}`;
            response.write(streamEvent("delta", { text: `\n${summaryBlock}` }));
          }
        }

        const instrumentedResponse = instrumentGeneratedResponse(completedResponse);
        response.write(streamEvent("final", { text: instrumentedResponse }));
        response.write(streamEvent("done"));
      } catch (error) {
        console.error("Error durante la respuesta incremental:", error);
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
    console.error("Error al procesar la solicitud:", error);
    response.status(502).json({
      error: "No se pudo obtener una respuesta de Gemini. Inténtalo de nuevo en unos momentos.",
    });
  };
  app.use(errorHandler);

  return app;
}
