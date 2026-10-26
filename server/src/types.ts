import type { BaseDoc } from "./base/schema.js";

export type ChatRole = "user" | "model";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Documento parcial de la base mientras el modelo escribe; el cliente lo aplica en vivo. */
export interface DocUpdate {
  kind: "doc";
  doc: BaseDoc;
}

/** Escena final de la base, lista para mostrarse antes de que termine el resumen. */
export interface SceneUpdate {
  kind: "scene";
  html: string;
}

export type ReplyChunk = string | DocUpdate | SceneUpdate;

export type GenerateReply = (
  messages: ChatMessage[],
  currentHtml?: string,
) => Promise<AsyncIterable<ReplyChunk>>;
