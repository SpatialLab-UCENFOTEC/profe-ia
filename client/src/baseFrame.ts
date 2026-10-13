// Protocolo con la base fija de la vista previa: el iframe se carga una vez y después recibe documentos por postMessage.
export const BASE_NAMESPACE = "profeia-base";
const BASE_DOC_PATTERN = /<script type="application\/json" id="profeia-base-doc">([\s\S]*?)<\/script>/;

export type BaseDocument = Record<string, unknown>;

export interface BaseApplyMessage {
  namespace: typeof BASE_NAMESPACE;
  type: "apply";
  doc: BaseDocument;
  runId?: string;
  draft: boolean;
}

export function isBaseHtml(html: string) {
  return html.includes('id="profeia-base-doc"');
}

// Recupera el documento embebido en el HTML final de la base (el servidor escapa "<" como <, que es JSON válido).
export function extractBaseDocument(html: string): BaseDocument | undefined {
  const match = BASE_DOC_PATTERN.exec(html);
  if (!match) return undefined;
  try {
    const doc = JSON.parse(match[1]) as unknown;
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc as BaseDocument : undefined;
  } catch {
    return undefined;
  }
}

export function applyMessage(doc: BaseDocument, options: { draft: boolean; runId?: string }): BaseApplyMessage {
  return { namespace: BASE_NAMESPACE, type: "apply", doc, runId: options.runId, draft: options.draft };
}

export function isBaseHello(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const message = data as { namespace?: unknown; type?: unknown };
  return message.namespace === BASE_NAMESPACE && message.type === "hello";
}
