import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { LlmProvider } from "./llm/types.js";
import type { ChatMessage, GenerateOptions, GenerateReply } from "./types.js";
import { SYSTEM_INSTRUCTION, withCurrentExperience } from "./prompt.js";
import { compileSceneResponse } from "./sceneTemplate.js";
import { applyPatchResponse } from "./patch.js";

export interface GeneratorOptions {
  /** Carpeta donde guardar la respuesta cruda del modelo (depuración). */
  rawLogDir?: string;
}

/**
 * Convierte un conjunto de LlmProvider en el GenerateReply que consume la app:
 * arma el prompt, detecta escena/parche/HTML, compila o aplica el resultado y,
 * si falla, pide al modelo una versión completa en HTML libre.
 */
export function createGenerator(
  resolveProvider: (id?: string) => LlmProvider | undefined,
  { rawLogDir }: GeneratorOptions = {},
): GenerateReply {
  async function* recordRaw(stream: AsyncIterable<string>, phase: string, label: string, file: string) {
    let raw = "";
    try {
      for await (const text of stream) {
        raw += text;
        yield text;
      }
    } finally {
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        appendFileSync(file, `===== ${phase} (${label}) =====\n${raw}\n\n`, "utf8");
      } catch (error) {
        console.error("No se pudo escribir el log crudo del LLM:", error);
      }
    }
  }

  return async (history: ChatMessage[], currentHtml?: string, options: GenerateOptions = {}) => {
    const provider = resolveProvider(options.provider);
    if (!provider) throw new Error(`Proveedor de LLM no disponible: ${options.provider}`);
    const label = `${provider.id}/${provider.model}`;
    const messages = withCurrentExperience(history, currentHtml);
    const rawFile = rawLogDir ? path.join(rawLogDir, `llm-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`) : undefined;
    const stream = (conversation: ChatMessage[], phase: string): AsyncIterable<string> => {
      const source = provider.streamText({ system: SYSTEM_INSTRUCTION, messages: conversation });
      return rawFile ? recordRaw(source, phase, label, rawFile) : source;
    };
    const responseStream = stream(messages, "respuesta");

    return (async function* () {
      let mode: "unknown" | "scene" | "patch" | "other" = "unknown";
      let buffered = "";
      for await (const text of responseStream) {
        if (!text) continue;
        if (mode === "other") { yield text; continue; }
        buffered += text;
        if (mode === "unknown") {
          const head = buffered.trimStart();
          if (head.startsWith("<webxr-scene>")) mode = "scene";
          else if (head.startsWith("<webxr-patch>")) { mode = "patch"; yield { phase: "patching" as const }; }
          else if (buffered.includes(">") || buffered.length > 100) mode = "other";
        }
        if (mode === "other") { yield buffered; buffered = ""; }
      }
      if (mode !== "scene" && mode !== "patch") { if (buffered) yield buffered; return; }
      const isPatch = buffered.trimStart().startsWith("<webxr-patch>");
      try {
        yield isPatch ? applyPatchResponse(buffered, currentHtml) : compileSceneResponse(buffered);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Escena inválida";
        const what = isPatch ? "El parche no se pudo aplicar" : "La escena compacta no se pudo construir";
        if (isPatch) yield { phase: "patch-fallback" as const };
        const fallback = stream([
          ...messages,
          { role: "assistant", content: buffered },
          { role: "user", content: `${what} (${reason}). Devuelve ahora una experiencia completa usando exclusivamente el FORMATO HTML LIBRE. Conserva todos los requisitos originales.` },
        ], "fallback");
        for await (const text of fallback) if (text) yield text;
      }
    })();
  };
}
