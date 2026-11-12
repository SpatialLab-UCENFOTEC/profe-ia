import { useEffect, useState } from "react";
import type { LlmProviderInfo } from "../types";

const STORAGE_KEY = "orbit-xr.provider";

function readStoredProvider() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Carga los proveedores de LLM del servidor y recuerda el elegido en este navegador. */
export function useProviders(enabled: boolean) {
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [selected, setSelected] = useState<string | undefined>(readStoredProvider);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/providers", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { default: string; providers: LlmProviderInfo[] };
        setProviders(data.providers);
        setSelected((current) => data.providers.some((provider) => provider.id === current) ? current : data.default);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);

  const select = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Sin almacenamiento disponible: la elección dura solo esta sesión.
    }
  };

  return { providers, selected, select };
}
