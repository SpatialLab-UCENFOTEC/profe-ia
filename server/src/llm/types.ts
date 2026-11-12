import type { ChatMessage } from "../types.js";

export interface StreamTextRequest {
  /** Instrucción de sistema completa. */
  system: string;
  /** Historial alternado que empieza y termina con un mensaje del usuario. */
  messages: ChatMessage[];
  signal?: AbortSignal;
}

/**
 * Único contrato que un modelo de lenguaje debe cumplir.
 * Un adaptador solo traduce mensajes a texto en streaming; el resto del producto
 * (prompt, escenas, parches, respaldos) vive fuera de él.
 */
export interface LlmProvider {
  /** Identificador estable que usan LLM_PROVIDERS y el campo `provider` de la API. */
  id: string;
  /** Nombre legible para la interfaz. */
  label: string;
  /** Modelo concreto que usa el adaptador. */
  model: string;
  streamText(request: StreamTextRequest): AsyncIterable<string>;
}

/**
 * Cómo se registra un adaptador: un id y una fábrica que lee su propia
 * configuración del entorno. Debe lanzar un error claro si falta algo obligatorio.
 */
export interface ProviderDefinition {
  id: string;
  create(env: NodeJS.ProcessEnv): LlmProvider;
}
