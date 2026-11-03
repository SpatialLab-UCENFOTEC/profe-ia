import type { ClassifiedDiagnostic } from "./previewDiagnostics";

export interface LineDiff {
  /** Índices (0-based) de las líneas de `before` que no sobreviven. */
  removed: number[];
  /** Índices (0-based) de las líneas de `after` que son nuevas. */
  added: number[];
}

/** Diff por líneas: recorta prefijo y sufijo comunes y aplica LCS al tramo del medio. */
export function diffLines(before: string, after: string): LineDiff {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start += 1;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  const oldMiddle = oldLines.slice(start, oldEnd);
  const newMiddle = newLines.slice(start, newEnd);
  const rows = oldMiddle.length;
  const columns = newMiddle.length;
  const lengths = new Uint32Array((rows + 1) * (columns + 1));
  const at = (row: number, column: number) => row * (columns + 1) + column;
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[at(row, column)] = oldMiddle[row] === newMiddle[column]
        ? lengths[at(row + 1, column + 1)] + 1
        : Math.max(lengths[at(row + 1, column)], lengths[at(row, column + 1)]);
    }
  }

  const removed: number[] = [];
  const added: number[] = [];
  let row = 0;
  let column = 0;
  while (row < rows && column < columns) {
    if (oldMiddle[row] === newMiddle[column]) {
      row += 1;
      column += 1;
    } else if (lengths[at(row + 1, column)] >= lengths[at(row, column + 1)]) {
      removed.push(start + row);
      row += 1;
    } else {
      added.push(start + column);
      column += 1;
    }
  }
  for (; row < rows; row += 1) removed.push(start + row);
  for (; column < columns; column += 1) added.push(start + column);
  return { removed, added };
}

/** Líneas (0-based) señaladas por los diagnósticos fatales que traen número de línea. */
export function diagnosticLines(diagnostics: ClassifiedDiagnostic[]): number[] {
  const lines = new Set<number>();
  for (const diagnostic of diagnostics) {
    const line = diagnostic.details.line;
    if (diagnostic.severity === "fatal" && typeof line === "number" && Number.isInteger(line) && line > 0) lines.add(line - 1);
  }
  return [...lines];
}
