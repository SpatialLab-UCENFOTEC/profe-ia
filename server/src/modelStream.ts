import { applyOp, applyOps, OPS_CLOSE, OPS_OPEN, parseOpLine, parseOps } from "./base/ops.js";
import { renderBaseHtml } from "./base/render.js";
import { type BaseDoc, DocError, validateDoc } from "./base/schema.js";
import type { DocUpdate, ReplyChunk } from "./types.js";

const HTML_OPEN = "<webxr-html>";
const DRAFT_INTERVAL_MS = 300;

export interface ModelStreamOptions {
  /** Documento sobre el que se aplican las operaciones. */
  baseDoc: BaseDoc;
  /** Pide al modelo una corrección cuando las operaciones no se pueden aplicar. */
  retry?: (failedResponse: string, reason: string) => Promise<AsyncIterable<string>>;
  now?: () => number;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Convierte la salida cruda del modelo en lo que consume el cliente:
 * - Con <webxr-ops>, cada operación completa se aplica a un borrador y se emite como documento (vista en vivo);
 *   al cerrar el bloque se aplica todo de forma atómica y se emite el HTML final de la base.
 * - Con <webxr-html> (motor distinto a la base), el texto pasa tal cual, como antes.
 */
export async function* processModelStream(raw: AsyncIterable<string>, options: ModelStreamOptions): AsyncGenerator<ReplyChunk> {
  const now = options.now ?? Date.now;
  const attempt = await runAttempt(raw, options.baseDoc, now);
  if (attempt.kind === "passthrough") {
    yield* attempt.chunks;
    return;
  }
  // Los borradores y el resultado salen del mismo generador para que el cliente vea la escena crecer.
  const first = yield* attempt.drain();
  if (first.ok || !options.retry) {
    yield* finish(first);
    return;
  }
  let retried: Awaited<ReturnType<typeof runAttempt>>;
  try {
    retried = await runAttempt(await options.retry(first.response, first.reason), options.baseDoc, now);
  } catch (error) {
    yield* finish({ ...first, reason: `${first.reason} (la corrección falló: ${errorMessage(error)})` });
    return;
  }
  if (retried.kind === "passthrough") {
    yield* retried.chunks;
    return;
  }
  yield* finish(yield* retried.drain());
}

type Outcome =
  | { ok: true; doc: BaseDoc; rest: string; response: string }
  | { ok: true; doc?: undefined; rest: string; response: string }
  | { ok: false; reason: string; rest: string; response: string };

function* finish(outcome: Outcome): Generator<ReplyChunk> {
  if (outcome.ok && !outcome.doc) {
    yield outcome.rest;
    return;
  }
  if (outcome.ok) {
    yield `${HTML_OPEN}${renderBaseHtml(outcome.doc)}</webxr-html>\n${outcome.rest.trim()}`;
    return;
  }
  yield `<assistant-response>No pude aplicar el cambio a la experiencia: ${outcome.reason}\n\nLa versión anterior sigue igual. Intenta pedirlo de otra forma o con menos cambios a la vez.</assistant-response>`;
}

async function runAttempt(raw: AsyncIterable<string>, baseDoc: BaseDoc, now: () => number) {
  const iterator = raw[Symbol.asyncIterator]();
  let head = "";
  // Se decide el modo con el inicio de la respuesta, sin esperar al final.
  while (true) {
    const result = await iterator.next();
    if (result.done) break;
    head += result.value;
    const trimmed = head.trimStart();
    if (trimmed.startsWith(HTML_OPEN)) {
      return { kind: "passthrough" as const, chunks: passthrough(head, iterator) };
    }
    if (trimmed.length >= HTML_OPEN.length || head.includes(OPS_OPEN)) break;
  }
  return { kind: "ops" as const, drain: () => drainOps(head, iterator, baseDoc, now) };
}

async function* passthrough(head: string, iterator: AsyncIterator<string>): AsyncGenerator<ReplyChunk> {
  yield head;
  while (true) {
    const result = await iterator.next();
    if (result.done) return;
    if (result.value) yield result.value;
  }
}

async function* drainOps(head: string, iterator: AsyncIterator<string>, baseDoc: BaseDoc, now: () => number): AsyncGenerator<DocUpdate, Outcome> {
  let text = head;
  let processedLines = 0;
  let draft = baseDoc;
  let draftChanged = false;
  let lastDraftAt = 0;
  let closed = false;

  const opsBody = () => {
    const start = text.indexOf(OPS_OPEN);
    if (start === -1) return undefined;
    const bodyStart = start + OPS_OPEN.length;
    const end = text.indexOf(OPS_CLOSE, bodyStart);
    return { body: text.slice(bodyStart, end === -1 ? undefined : end), closed: end !== -1 };
  };

  // Aplica al borrador las líneas completas nuevas; un error en un borrador no corta nada, se resuelve al final.
  const advanceDraft = () => {
    const ops = opsBody();
    if (!ops) return;
    const lines = ops.body.split("\n");
    const complete = ops.closed ? lines : lines.slice(0, -1);
    for (let index = processedLines; index < complete.length; index += 1) {
      const line = complete[index].trim();
      if (!line || line.startsWith("//") || line.startsWith("```") || line === "[" || line === "]") continue;
      try {
        draft = applyOp(draft, parseOpLine(line.replace(/,$/, ""), index), index);
        draftChanged = true;
      } catch {
        // La validación completa al cerrar el bloque reporta el problema real.
      }
    }
    processedLines = complete.length;
  };

  function* emitDraft(): Generator<DocUpdate> {
    if (!draftChanged || now() - lastDraftAt < DRAFT_INTERVAL_MS) return;
    try {
      const doc = validateDoc(structuredClone(draft));
      draftChanged = false;
      lastDraftAt = now();
      yield { kind: "doc", doc };
    } catch {
      // Un estado intermedio inválido (un hijo antes que su panel) espera a la próxima operación.
    }
  }

  advanceDraft();
  yield* emitDraft();
  while (!closed) {
    const result = await iterator.next();
    if (result.done) break;
    text += result.value;
    advanceDraft();
    closed = Boolean(opsBody()?.closed);
    if (!closed) yield* emitDraft();
  }
  // El resto (el resumen) se junta completo antes de decidir qué se manda.
  while (true) {
    const result = await iterator.next();
    if (result.done) break;
    text += result.value;
  }

  const ops = opsBody();
  if (!ops) {
    // Respuesta conversacional, sin cambios en la experiencia.
    return { ok: true, rest: text, response: text };
  }
  const start = text.indexOf(OPS_OPEN);
  const end = ops.closed ? text.indexOf(OPS_CLOSE, start) + OPS_CLOSE.length : text.length;
  const rest = `${text.slice(0, start)}${text.slice(end)}`;
  try {
    const doc = applyOps(baseDoc, parseOps(ops.body));
    return { ok: true, doc, rest, response: text };
  } catch (error) {
    if (!(error instanceof DocError) && !(error instanceof SyntaxError)) throw error;
    return { ok: false, reason: errorMessage(error), rest, response: text };
  }
}
