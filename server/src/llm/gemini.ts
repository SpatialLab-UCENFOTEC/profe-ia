import { GoogleGenAI, type Content } from "@google/genai";
import type { LlmProvider, ProviderDefinition, StreamTextRequest } from "./types.js";

/** Adaptador de Google Gemini mediante el SDK @google/genai y una API key de Google AI Studio. */
export interface GeminiOptions {
  apiKey: string;
  model: string;
  temperature?: number;
}

export function createGeminiProvider({ apiKey, model, temperature = 0.45 }: GeminiOptions): LlmProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    id: "gemini",
    label: `Gemini ${model}`,
    model,
    async *streamText({ system, messages, signal }: StreamTextRequest) {
      // Gemini llama "model" al rol del asistente.
      const contents: Content[] = messages.map(({ role, content }) => ({
        role: role === "assistant" ? "model" : "user",
        parts: [{ text: content }],
      }));
      const stream = await ai.models.generateContentStream({
        model,
        contents,
        config: { systemInstruction: system, temperature, abortSignal: signal },
      });
      for await (const chunk of stream) {
        if (chunk.text) yield chunk.text;
      }
    },
  };
}

/** Variables: GEMINI_API_KEY (obligatoria), GEMINI_MODEL (por defecto gemini-3.6-flash). */
export const geminiDefinition: ProviderDefinition = {
  id: "gemini",
  create: (env) => {
    if (!env.GEMINI_API_KEY) throw new Error("El adaptador gemini necesita GEMINI_API_KEY.");
    return createGeminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.6-flash" });
  },
};
