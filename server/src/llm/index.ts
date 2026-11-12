import { claudeCliDefinition } from "./claudeCli.js";
import { geminiDefinition } from "./gemini.js";
import type { LlmProvider, ProviderDefinition } from "./types.js";

export type { LlmProvider, ProviderDefinition, StreamTextRequest } from "./types.js";

/**
 * Adaptadores disponibles. Para conectar otro modelo, crea un archivo en esta
 * carpeta que exporte un ProviderDefinition y añádelo a esta lista.
 * Este es el único lugar del servidor que conoce los adaptadores concretos.
 */
export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [claudeCliDefinition, geminiDefinition];

export interface ProviderRegistry {
  /** Proveedores activos, en el orden de LLM_PROVIDERS. */
  providers: LlmProvider[];
  defaultId: string;
  /** Devuelve el proveedor pedido o el predeterminado si no se indica ninguno. */
  get(id?: string): LlmProvider | undefined;
}

export function createProviderRegistry(
  env: NodeJS.ProcessEnv = process.env,
  definitions: ProviderDefinition[] = PROVIDER_DEFINITIONS,
): ProviderRegistry {
  const known = new Map(definitions.map((definition) => [definition.id, definition]));
  const requested = (env.LLM_PROVIDERS || definitions[0]?.id || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (requested.length === 0) throw new Error("LLM_PROVIDERS está vacío.");

  const providers: LlmProvider[] = [];
  for (const id of new Set(requested)) {
    const definition = known.get(id);
    if (!definition) {
      throw new Error(`LLM_PROVIDERS: proveedor desconocido "${id}". Opciones: ${[...known.keys()].join(", ")}.`);
    }
    providers.push(definition.create(env));
  }

  const defaultId = env.LLM_DEFAULT_PROVIDER?.trim() || providers[0].id;
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  if (!byId.has(defaultId)) {
    throw new Error(`LLM_DEFAULT_PROVIDER "${defaultId}" no está en LLM_PROVIDERS (${[...byId.keys()].join(", ")}).`);
  }

  return {
    providers,
    defaultId,
    get: (id) => byId.get(id ?? defaultId),
  };
}
