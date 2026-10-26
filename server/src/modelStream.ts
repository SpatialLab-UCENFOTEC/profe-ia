import { applyOp, applyOpsLenient, type LenientResult, OPS_CLOSE, OPS_OPEN, type OpProblem, parseOpLine } from "./base/ops.js";
import { renderBaseHtml } from "./base/render.js";
import { type BaseDoc, validateDoc } from "./base/schema.js";
import type { DocUpdate, ReplyChunk } from "./types.js";

const HTML_OPEN = "<webxr-html>";
const DRAFT_INTERVAL_MS = 300;
const MAX_PROBLEMS_TEXT = 6_000;

export interface ModelStreamOptions {
  /** Documento sobre el que se aplican las operaciones. */
  baseDoc: BaseDoc;
  /**
   * Pide al modelo solo las operaciones que corrigen lo que no se pudo aplicar. El resto de la
   * respuesta ya quedó aplicado, así que la corrección es corta.
   */
  retry?: (failedResponse: string, problems: string) => Promise<AsyncIterable<string>>;
  now?: () => number;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function describeProblems(problems: OpProblem[]) {
  return problems.map(problem => {
    const target = problem.kind && problem.id ? `${problem.kind} "${problem.id}"` : problem.kind ?? "operación";
    return `- ${target}: ${problem.message}${problem.line ? `\n  línea: ${problem.line.slice(0, 600)}` : ""}`;
  }).join("\n").slice(0, MAX_PROBLEMS_TEXT);
}

/**
 * Convierte la salida cruda del modelo en lo que consume el cliente:
 * - Con <webxr-ops>, cada operación completa se aplica a un borrador y se emite como documento (vista en vivo).
 *   Al cerrar el bloque sale la escena final (evento scene) sin esperar el resumen, que llega después.
 *   Lo que no se pudo aplicar se descarta y se pide al modelo solo esa corrección.
 * - Con <webxr-html> (motor distinto a la base), el texto pasa tal cual, como antes.
 */
export async function* processModelStream(raw: AsyncIterable<string>, options: ModelStreamOptions): AsyncGenerator<ReplyChunk> {
  const now = options.now ?? Date.now;
  const attempt = await runAttempt(raw, options.baseDoc, now);
  if (attempt.kind === "passthrough") {
    yield* attempt.chunks;
    return;
  }
  const first = yield* attempt.drain();
  if (first.kind === "chat") {
    yield first.text;
    return;
  }

  let { result, before, after } = first;
  // Una pieza aplicada y después descartada por inválida no cuenta como cambio.
  const changed = (doc: BaseDoc) => JSON.stringify(doc) !== JSON.stringify(options.baseDoc);
  let tail: AsyncIterator<string> | undefined = first.tail;
  if (result.problems.length > 0 && options.retry) {
    // El resumen del intento fallido no sirve: se corta para no esperarlo.
    await first.tail.return?.();
    tail = undefined;
    after = "";
    // Mientras llega la corrección, la escena muestra todo lo que sí se aplicó.
    if (changed(result.doc)) yield { kind: "doc", doc: result.doc };
    try {
      const correction = await runAttempt(await options.retry(first.response, describeProblems(result.problems)), result.doc, now);
      if (correction.kind === "passthrough") {
        yield* correction.chunks;
        return;
      }
      const second = yield* correction.drain();
      if (second.kind === "chat") {
        after = second.text;
      } else {
        result = second.result;
        before = second.before;
        after = second.after;
        tail = second.tail;
      }
    } catch (error) {
      console.error("La corrección de operaciones falló:", errorMessage(error));
    }
  }

  if (!changed(result.doc)) {
    if (result.problems.length > 0) {
      yield `<assistant-response>No pude aplicar el cambio a la experiencia: ${result.problems.map(problem => problem.message).join(" ")}\n\nLa versión anterior sigue igual. Intenta pedirlo de otra forma o con menos cambios a la vez.</assistant-response>`;
      return;
    }
    yield `${before}${after}`;
    if (tail) yield* rest(tail);
    return;
  }
  if (result.problems.length > 0) console.warn(`Se descartaron ${result.problems.length} piezas inválidas:\n${describeProblems(result.problems)}`);

  const html = renderBaseHtml(result.doc);
  yield { kind: "scene", html };
  yield `${HTML_OPEN}${html}</webxr-html>\n${`${before.trim()}${after}`.trimStart()}`;
  if (!tail) return;
  // La escena ya salió: si el resumen se corta, la experiencia vale igual y el servidor completa el texto.
  try {
    yield* rest(tail);
  } catch (error) {
    console.error("El resumen se interrumpió después de la escena:", errorMessage(error));
  }
}

async function* rest(iterator: AsyncIterator<string>): AsyncGenerator<string> {
  while (true) {
    const result = await iterator.next();
    if (result.done) return;
    if (result.value) yield result.value;
  }
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
  yield* rest(iterator);
}

type Drained =
  | { kind: "chat"; text: string }
  | { kind: "ops"; result: LenientResult; before: string; after: string; response: string; tail: AsyncIterator<string> };

async function* drainOps(head: string, iterator: AsyncIterator<string>, baseDoc: BaseDoc, now: () => number): AsyncGenerator<DocUpdate, Drained> {
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
    return { start, body: text.slice(bodyStart, end === -1 ? undefined : end), end };
  };

  // Aplica al borrador las líneas completas nuevas; un error en un borrador no corta nada, se resuelve al final.
  const advanceDraft = () => {
    const ops = opsBody();
    if (!ops) return;
    const lines = ops.body.split("\n");
    const complete = ops.end !== -1 ? lines : lines.slice(0, -1);
    for (let index = processedLines; index < complete.length; index += 1) {
      const line = complete[index].trim();
      if (!line || line.startsWith("//") || line.startsWith("```") || line === "[" || line === "]") continue;
      try {
        draft = applyOp(draft, parseOpLine(line.replace(/,$/, ""), index), index);
        draftChanged = true;
      } catch {
        // La validación al cerrar el bloque reporta el problema real.
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
  closed = (opsBody()?.end ?? -1) !== -1;
  if (!closed) yield* emitDraft();
  while (!closed) {
    const result = await iterator.next();
    if (result.done) break;
    text += result.value;
    advanceDraft();
    closed = (opsBody()?.end ?? -1) !== -1;
    if (!closed) yield* emitDraft();
  }

  const ops = opsBody();
  // Sin bloque de operaciones es una respuesta conversacional: ya se leyó entera.
  if (!ops) return { kind: "chat", text };
  // Un bloque sin cerrar (el modelo se cortó) se aplica con lo que llegó.
  const end = ops.end === -1 ? text.length : ops.end + OPS_CLOSE.length;
  return {
    kind: "ops",
    result: applyOpsLenient(baseDoc, ops.body),
    before: text.slice(0, ops.start),
    after: text.slice(end),
    response: text.slice(0, end),
    tail: iterator,
  };
}
