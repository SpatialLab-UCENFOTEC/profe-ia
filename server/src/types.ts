export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Texto del modelo o una señal de fase (p. ej. el modelo empezó a responder con un parche). */
export type ReplyChunk = string | { phase: "patching" | "patch-fallback" };

export interface GenerateOptions {
  /** Id del proveedor de LLM a usar; si se omite, el predeterminado. */
  provider?: string;
}

export type GenerateReply = (
  messages: ChatMessage[],
  currentHtml?: string,
  options?: GenerateOptions,
) => Promise<AsyncIterable<ReplyChunk>>;

/** Datos públicos de un proveedor configurado. */
export interface ProviderInfo {
  id: string;
  label: string;
  model: string;
}
