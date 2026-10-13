import { type BaseDoc, DocError, emptyDoc, validateDoc } from "./schema.js";

// Cambios que el modelo pide sobre el documento. Se aplican todos o ninguno.
export type Op =
  | { op: "reset" }
  | { op: "meta"; value: { title?: string; instructions?: string } }
  | { op: "env"; value: Record<string, unknown> }
  | { op: "set" | "merge" | "remove"; kind: OpKind; id: string; value?: unknown };

export type OpKind = "entity" | "ui" | "script" | "style";

const COLLECTION: Record<OpKind, "entities" | "ui" | "scripts" | "styles"> = {
  entity: "entities",
  ui: "ui",
  script: "scripts",
  style: "styles",
};

export const OPS_OPEN = "<webxr-ops>";
export const OPS_CLOSE = "</webxr-ops>";
export const MAX_OPS = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseOpLine(line: string, index: number): Op {
  let value: unknown;
  try { value = JSON.parse(line); }
  catch { throw new DocError(`La operación ${index + 1} no es JSON válido: ${line.slice(0, 120)}`); }
  return checkOp(value, index);
}

function checkOp(value: unknown, index: number): Op {
  const label = `La operación ${index + 1}`;
  if (!isRecord(value) || typeof value.op !== "string") throw new DocError(`${label} debe ser un objeto con "op".`);
  switch (value.op) {
    case "reset":
      return { op: "reset" };
    case "meta":
    case "env":
      if (!isRecord(value.value)) throw new DocError(`${label} (${value.op}) necesita "value" como objeto.`);
      return { op: value.op, value: value.value } as Op;
    case "set":
    case "merge":
    case "remove":
      if (typeof value.kind !== "string" || !(value.kind in COLLECTION)) throw new DocError(`${label} necesita "kind": entity, ui, script o style.`);
      if (typeof value.id !== "string" || !value.id) throw new DocError(`${label} necesita "id".`);
      if (value.op !== "remove" && value.value === undefined) throw new DocError(`${label} (${value.op}) necesita "value".`);
      return { op: value.op, kind: value.kind as OpKind, id: value.id, value: value.value };
    default:
      throw new DocError(`${label} tiene un "op" desconocido: ${String(value.op)}. Usa reset, meta, env, set, merge o remove.`);
  }
}

// Acepta una operación JSON por línea o una lista JSON.
export function parseOps(text: string): Op[] {
  const body = text.split("\n").filter(line => !line.trim().startsWith("```")).join("\n").trim();
  if (!body) return [];
  if (body.startsWith("[")) {
    let list: unknown;
    try { list = JSON.parse(body); }
    catch { throw new DocError("La lista de operaciones no es JSON válido."); }
    if (!Array.isArray(list)) throw new DocError("La lista de operaciones debe ser un arreglo.");
    if (list.length > MAX_OPS) throw new DocError(`Hay más de ${MAX_OPS} operaciones.`);
    return list.map((item, index) => checkOp(item, index));
  }
  const lines = body.split("\n").map(line => line.trim()).filter(line => line && !line.startsWith("//")).map(line => line.replace(/,$/, ""));
  if (lines.length > MAX_OPS) throw new DocError(`Hay más de ${MAX_OPS} operaciones.`);
  return lines.map((line, index) => parseOpLine(line, index));
}

function mergeDeep(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch;
  const base: Record<string, unknown> = isRecord(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete base[key];
    else base[key] = isRecord(value) ? mergeDeep(base[key], value) : value;
  }
  return base;
}

function normalizeItem(kind: OpKind, value: unknown) {
  if (kind === "script" && typeof value === "string") return { code: value };
  return value;
}

// Aplica una operación sobre una copia; no valida el documento completo.
export function applyOp(doc: BaseDoc, op: Op, index = 0): BaseDoc {
  const next = structuredClone(doc);
  switch (op.op) {
    case "reset":
      return emptyDocWithoutPlaceholder();
    case "meta":
      if (op.value.title !== undefined) next.title = op.value.title;
      if (op.value.instructions !== undefined) next.instructions = op.value.instructions;
      return next;
    case "env": {
      // floor: null significa "sin piso", así que el piso se trata aparte del borrado por null.
      const { floor, ...rest } = op.value;
      next.environment = mergeDeep(next.environment, rest) as BaseDoc["environment"];
      if (floor !== undefined) next.environment.floor = floor as string | null;
      return next;
    }
    default: {
      const collection = next[COLLECTION[op.kind]] as Record<string, unknown>;
      if (op.op === "remove") {
        delete collection[op.id];
        return next;
      }
      if (op.op === "set") {
        collection[op.id] = normalizeItem(op.kind, op.value);
        return next;
      }
      if (!(op.id in collection)) throw new DocError(`La operación ${index + 1} hace merge sobre ${op.kind} "${op.id}", que no existe. Usa set para crearlo.`);
      if (op.kind === "style") {
        if (typeof op.value !== "string") throw new DocError(`La operación ${index + 1}: un style se reemplaza con set y texto CSS.`);
        collection[op.id] = op.value;
        return next;
      }
      collection[op.id] = mergeDeep(collection[op.id], normalizeItem(op.kind, op.value));
      return next;
    }
  }
}

// El panel de bienvenida de la escena vacía no sobrevive a la primera experiencia.
function emptyDocWithoutPlaceholder(): BaseDoc {
  const doc = emptyDoc();
  doc.ui = {};
  doc.title = "Experiencia WebXR";
  doc.instructions = "";
  return doc;
}

export function applyOps(doc: BaseDoc, ops: Op[]): BaseDoc {
  let next = doc;
  ops.forEach((op, index) => {
    next = applyOp(next, op, index);
  });
  try {
    return validateDoc(next);
  } catch (error) {
    if (error instanceof DocError) throw new DocError(`Después de aplicar las operaciones: ${error.message}`);
    throw error;
  }
}
