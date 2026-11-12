import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type { ChatMessage } from "../types.js";
import type { LlmProvider, ProviderDefinition, StreamTextRequest } from "./types.js";

/**
 * Adaptador que usa la CLI de Claude Code instalada y autenticada en esta máquina
 * (`claude -p`). No necesita clave de API, pero solo funciona donde la CLI tenga
 * una sesión iniciada: sirve para desarrollo y pruebas locales, no para Railway.
 */
export interface ClaudeCliOptions {
  /** Alias (`haiku`, `sonnet`, `opus`) o ID completo del modelo. */
  model: string;
  /** Ruta del ejecutable. Por defecto `claude` del PATH. */
  command?: string;
  /** Límite de tokens de salida por respuesta. */
  maxOutputTokens?: number;
}

export type CliEvent = { type: "text"; text: string } | { type: "error"; message: string };

/** Interpreta una línea de `--output-format stream-json`. Devuelve null si no aporta nada. */
export function parseStreamJsonLine(line: string): CliEvent | null {
  let data: Record<string, any>;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (data?.type === "stream_event") {
    const event = data.event;
    if (event?.type === "content_block_delta" && event.delta?.type === "text_delta" && typeof event.delta.text === "string") {
      return { type: "text", text: event.delta.text };
    }
    return null;
  }
  if (data?.type === "result" && data.is_error) {
    const detail = typeof data.result === "string" && data.result ? data.result : data.subtype ?? "error desconocido";
    return { type: "error", message: `La CLI de Claude terminó con error: ${detail}` };
  }
  return null;
}

/**
 * `claude -p` recibe un solo prompt, así que el historial se serializa como transcript.
 * Con un único mensaje se envía tal cual.
 */
export function serializeConversation(messages: ChatMessage[]): string {
  const last = messages.at(-1);
  if (!last) return "";
  if (messages.length === 1) return last.content;
  const turns = messages
    .slice(0, -1)
    .map(({ role, content }) => `<turn role="${role}">\n${content}\n</turn>`)
    .join("\n");
  return `Historial previo de la conversación (contexto; tus respuestas anteriores aparecen como role="assistant"):\n<conversation>\n${turns}\n</conversation>\n\nMensaje actual del usuario, al que debes responder ahora siguiendo el formato indicado:\n${last.content}`;
}

export function createClaudeCliProvider({ model, command = "claude", maxOutputTokens = 64_000 }: ClaudeCliOptions): LlmProvider {
  return {
    id: "claude-cli",
    label: `Claude ${model} (CLI local)`,
    model,
    async *streamText({ system, messages, signal }: StreamTextRequest) {
      const child = spawn(command, [
        "-p",
        "--model", model,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--system-prompt", system,
        "--tools", "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--setting-sources", "",
      ], {
        // Fuera del repositorio para que la CLI no cargue CLAUDE.md ni configuración del proyecto.
        cwd: tmpdir(),
        env: { ...process.env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxOutputTokens) },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });

      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      // Evita un rechazo no manejado si el proceso falla antes de que lo esperemos.
      exited.catch(() => undefined);

      const abort = () => child.kill();
      signal?.addEventListener("abort", abort, { once: true });

      child.stdin.on("error", () => undefined);
      child.stdin.end(serializeConversation(messages), "utf8");

      let failure: string | undefined;
      try {
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        for await (const line of lines) {
          const event = parseStreamJsonLine(line);
          if (!event) continue;
          if (event.type === "error") { failure = event.message; continue; }
          yield event.text;
        }
        const code = await exited;
        if (failure) throw new Error(failure);
        if (code !== 0) throw new Error(`La CLI de Claude salió con código ${code}: ${stderr.trim() || "sin detalle"}`);
      } finally {
        signal?.removeEventListener("abort", abort);
        if (child.exitCode === null) child.kill();
      }
    },
  };
}

/** Variables: CLAUDE_CLI_MODEL (por defecto haiku), CLAUDE_CLI_PATH, CLAUDE_CLI_MAX_OUTPUT_TOKENS. */
export const claudeCliDefinition: ProviderDefinition = {
  id: "claude-cli",
  create: (env) => createClaudeCliProvider({
    model: env.CLAUDE_CLI_MODEL || "haiku",
    command: env.CLAUDE_CLI_PATH || undefined,
    maxOutputTokens: Number(env.CLAUDE_CLI_MAX_OUTPUT_TOKENS) || undefined,
  }),
};
