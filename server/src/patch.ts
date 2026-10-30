import { stripPreviewMonitor } from "./previewMonitor.js";
import { extractSceneSpec, renderScene } from "./sceneTemplate.js";

const PATCH_OPEN = "<webxr-patch>";
const PATCH_CLOSE = "</webxr-patch>";

export class PatchError extends Error {}

export interface HtmlEdit { search: string; replace: string }

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeSet(target: Json, set: unknown, label: string): void {
  if (!isRecord(set)) throw new PatchError(`${label}: "set" debe ser un objeto.`);
  for (const [key, value] of Object.entries(set)) {
    if (value === null) delete target[key];
    else target[key] = value;
  }
}

export function applySceneOps(specJson: string, opsJson: string): unknown {
  let spec: Json;
  let payload: unknown;
  try {
    spec = JSON.parse(specJson) as Json;
    payload = JSON.parse(opsJson);
  } catch {
    throw new PatchError("El parche de escena no es JSON válido.");
  }
  const ops = isRecord(payload) ? payload.ops : undefined;
  if (!Array.isArray(ops) || ops.length === 0) throw new PatchError("El parche de escena no contiene operaciones.");
  const objects = (spec.objects as Json[]).map(object => ({ ...object }));
  const find = (id: unknown): Json => {
    const object = objects.find(item => item.id === id);
    if (!object) throw new PatchError(`El objeto ${String(id)} no existe.`);
    return object;
  };
  for (const [index, op] of ops.entries()) {
    if (!isRecord(op)) throw new PatchError(`Operación ${index} inválida.`);
    switch (op.op) {
      case "add":
        if (!isRecord(op.object)) throw new PatchError(`Operación ${index}: falta "object".`);
        objects.push({ ...op.object });
        break;
      case "update":
        mergeSet(find(op.id), op.set, `Operación ${index}`);
        break;
      case "remove":
        objects.splice(objects.indexOf(find(op.id)), 1);
        break;
      case "setRoot":
        mergeSet(spec, op.set, `Operación ${index}`);
        break;
      default:
        throw new PatchError(`Operación ${index}: "${String(op.op)}" no admitida.`);
    }
  }
  return { ...spec, objects };
}

export function parseHtmlEdits(body: string): HtmlEdit[] {
  const edits = [...body.matchAll(/<edit>\s*<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit>/g)]
    .map(([, search, replace]) => ({ search, replace }));
  if (edits.length === 0) throw new PatchError("El parche HTML no contiene ediciones.");
  return edits;
}

export function applyHtmlEdits(html: string, edits: HtmlEdit[]): string {
  let result = html;
  for (const [index, { search, replace }] of edits.entries()) {
    if (!search) throw new PatchError(`Edición ${index}: búsqueda vacía.`);
    const first = result.indexOf(search);
    if (first === -1) throw new PatchError(`Edición ${index}: el texto a buscar no existe.`);
    if (result.indexOf(search, first + 1) !== -1) throw new PatchError(`Edición ${index}: el texto a buscar no es único.`);
    result = result.slice(0, first) + replace + result.slice(first + search.length);
  }
  return result;
}

/** Aplica el bloque <webxr-patch> de la respuesta sobre el documento vigente y lo sustituye por <webxr-html>. */
export function applyPatchResponse(response: string, currentHtml: string | undefined): string {
  const start = response.indexOf(PATCH_OPEN);
  if (start === -1) return response;
  const end = response.indexOf(PATCH_CLOSE, start + PATCH_OPEN.length);
  if (end === -1) throw new PatchError("El parche está incompleto.");
  if (!currentHtml) throw new PatchError("No hay documento vigente al que aplicar el parche.");
  const body = response.slice(start + PATCH_OPEN.length, end);
  const specJson = extractSceneSpec(currentHtml);
  let html: string;
  try {
    html = specJson
      ? renderScene(applySceneOps(specJson, body))
      : applyHtmlEdits(stripPreviewMonitor(currentHtml), parseHtmlEdits(body));
  } catch (error) {
    if (error instanceof PatchError) throw error;
    throw new PatchError(error instanceof Error ? error.message : "Parche inválido.");
  }
  return `${response.slice(0, start)}<webxr-html>\n${html}\n</webxr-html>${response.slice(end + PATCH_CLOSE.length)}`;
}
