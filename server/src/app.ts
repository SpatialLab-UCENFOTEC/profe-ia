import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import type { ChatMessage, GenerateReply } from "./types.js";

const MAX_MESSAGES = 30;
const MAX_MESSAGE_LENGTH = 8_000;

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

export interface AppOptions {
  generateReply: GenerateReply;
  model: string;
  clientDist?: string;
}

export function createApp({ generateReply, model, clientDist }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, model });
  });

  app.post("/api/chat", async (request, response, next) => {
    const messages = parseMessages(request.body?.messages);
    if (!messages) {
      response.status(400).json({
        error: `Se requiere un historial de 1 a ${MAX_MESSAGES} mensajes válidos y debe terminar con un mensaje del usuario.`,
      });
      return;
    }

    try {
      const reply = await generateReply(messages);
      response.json({ reply });
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
