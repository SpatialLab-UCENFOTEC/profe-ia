import express, { type ErrorRequestHandler } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { ChatMessage, GenerateReply } from "./types.js";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_HTML_LENGTH = 250_000;
const SESSION_COOKIE = "profeia_session";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

interface Session {
  expiresAt: number;
}

interface LoginAttempts {
  count: number;
  resetAt: number;
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

function streamEvent(type: "delta" | "done" | "error", payload: Record<string, unknown> = {}) {
  return `${JSON.stringify({ type, ...payload })}\n`;
}

export interface AppOptions {
  generateReply: GenerateReply;
  model: string;
  accessPassword: string;
  clientDist?: string;
}

export function createApp({ generateReply, model, accessPassword, clientDist }: AppOptions) {
  const app = express();
  const sessions = new Map<string, Session>();
  const loginAttempts = new Map<string, LoginAttempts>();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, model });
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
    const attempts = loginAttempts.get(clientKey);
    if (attempts && attempts.resetAt > now && attempts.count >= MAX_LOGIN_ATTEMPTS) {
      response.setHeader("Retry-After", String(Math.ceil((attempts.resetAt - now) / 1000)));
      response.status(429).json({ error: "Demasiados intentos. Espera unos minutos antes de volver a intentar." });
      return;
    }

    const password = request.body?.password;
    if (typeof password !== "string" || !passwordsMatch(password, accessPassword)) {
      const current = attempts && attempts.resetAt > now ? attempts : { count: 0, resetAt: now + LOGIN_WINDOW_MS };
      current.count += 1;
      loginAttempts.set(clientKey, current);
      response.status(401).json({ error: "Contraseña incorrecta." });
      return;
    }

    loginAttempts.delete(clientKey);
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

  app.post("/api/chat", async (request, response, next) => {
    const messages = parseMessages(request.body?.messages);
    const currentHtml = parseCurrentHtml(request.body?.currentHtml);
    if (!messages || currentHtml === null) {
      response.status(400).json({
        error: `Se requiere un historial de 1 a ${MAX_MESSAGES} mensajes válidos, debe terminar con un mensaje del usuario y el HTML actual no puede superar ${MAX_HTML_LENGTH} caracteres.`,
      });
      return;
    }

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

      let emittedText = false;
      const writeChunk = (chunk: string) => {
        if (!chunk) return;
        emittedText = true;
        response.write(streamEvent("delta", { text: chunk }));
      };

      writeChunk(first.value);
      try {
        while (true) {
          const result = await iterator.next();
          if (result.done) break;
          writeChunk(result.value);
        }

        if (!emittedText) {
          response.write(streamEvent("error", { message: "Gemini devolvió una respuesta vacía." }));
        } else {
          response.write(streamEvent("done"));
        }
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
