import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createProviderRegistry } from "../src/llm/index.js";
import type { ProviderDefinition } from "../src/llm/types.js";

function definition(id: string, required?: string): ProviderDefinition {
  return {
    id,
    create: (env) => {
      if (required && !env[required]) throw new Error(`${id} necesita ${required}`);
      return { id, label: id.toUpperCase(), model: env[`${id.toUpperCase()}_MODEL`] ?? "base", async *streamText() { yield id; } };
    },
  };
}

const definitions = [definition("uno"), definition("dos", "DOS_KEY")];

describe("Registro de proveedores", () => {
  it("activa el primer adaptador si no se configura nada", () => {
    const registry = createProviderRegistry({}, definitions);
    assert.deepEqual(registry.providers.map((provider) => provider.id), ["uno"]);
    assert.equal(registry.defaultId, "uno");
    assert.equal(registry.get()?.id, "uno");
  });

  it("activa varios, respeta el predeterminado y resuelve por id", () => {
    const registry = createProviderRegistry({ LLM_PROVIDERS: "uno, dos", LLM_DEFAULT_PROVIDER: "dos", DOS_KEY: "x", DOS_MODEL: "grande" }, definitions);
    assert.equal(registry.defaultId, "dos");
    assert.equal(registry.get()?.model, "grande");
    assert.equal(registry.get("uno")?.id, "uno");
    assert.equal(registry.get("tres"), undefined);
  });

  it("explica la configuración inválida", () => {
    assert.throws(() => createProviderRegistry({ LLM_PROVIDERS: "tres" }, definitions), /desconocido "tres".*uno, dos/);
    assert.throws(() => createProviderRegistry({ LLM_PROVIDERS: "dos" }, definitions), /DOS_KEY/);
    assert.throws(() => createProviderRegistry({ LLM_PROVIDERS: "uno", LLM_DEFAULT_PROVIDER: "dos" }, definitions), /no está en LLM_PROVIDERS/);
  });
});
