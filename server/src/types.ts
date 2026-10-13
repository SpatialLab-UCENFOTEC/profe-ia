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

export type ReplyChunk = string | DocUpdate;

export type GenerateReply = (
  messages: ChatMessage[],
  currentHtml?: string,
) => Promise<AsyncIterable<ReplyChunk>>;
