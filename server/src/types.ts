export type ChatRole = "user" | "model";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Texto del modelo o una señal de fase (p. ej. el modelo empezó a responder con un parche). */
export type ReplyChunk = string | { phase: "patching" | "patch-fallback" };

export type GenerateReply = (
  messages: ChatMessage[],
  currentHtml?: string,
) => Promise<AsyncIterable<ReplyChunk>>;
