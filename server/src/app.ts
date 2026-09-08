import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import type { ChatMessage, GenerateReply } from "./types.js";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_HTML_LENGTH = 250_000;

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
  clientDist?: string;
}

export function createApp({ generateReply, model, clientDist }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, model });
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
