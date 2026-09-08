import { GoogleGenAI, type Content } from "@google/genai";
import type { ChatMessage, GenerateReply } from "./types.js";

const SYSTEM_INSTRUCTION =
  "Eres un asistente útil, claro y amable. Responde en el idioma del usuario. Usa formato legible y sé conciso salvo que te pidan más detalle.";

export function createGeminiGenerator(apiKey: string, model: string): GenerateReply {
  const ai = new GoogleGenAI({ apiKey });

  return async (messages: ChatMessage[]) => {
    const contents: Content[] = messages.map(({ role, content }) => ({
      role,
      parts: [{ text: content }],
    }));

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error("Gemini devolvió una respuesta vacía.");
    }

    return text;
  };
}
