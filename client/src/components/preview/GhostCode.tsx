import { memo, useEffect, useMemo, useRef, useState } from "react";
import { diffLines, type LineDiff } from "../../codeTrace";
import { GHOST_DIFF_MARK_MS, GHOST_DIFF_SETTLE_MS, GHOST_SCAN_STEP_MS } from "../../constants";
import type { GhostDiff } from "../../types";

/**
 * stream: código entrando, sigue el final. scan: un resaltado verde recorre las líneas (solo estético).
 * error: líneas afectadas en rojo. plain: código quieto.
 */
export type GhostMode = "stream" | "scan" | "error" | "plain";
type LineTone = "scan" | "error" | "added";

interface DiffSequence {
  step: "mark" | "settle";
  diff: GhostDiff;
  changes: LineDiff;
}

const GhostLine = memo(function GhostLine({ index, text, tone }: { index: number; text: string; tone?: LineTone }) {
  return <span data-line={index} className={tone ? `ghost-line is-${tone}` : "ghost-line"}>{text || " "}</span>;
});

export function GhostCode({
  code,
  mode,
  diff,
  errorLines,
  onSequenceChange,
}: {
  code: string;
  mode: GhostMode;
  diff: GhostDiff | null;
  errorLines: number[];
  onSequenceChange: (active: boolean) => void;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const onSequenceChangeRef = useRef(onSequenceChange);
  onSequenceChangeRef.current = onSequenceChange;
  const [scanLine, setScanLine] = useState(0);
  const [sequence, setSequence] = useState<DiffSequence | null>(null);

  // Parche aplicado: líneas viejas en rojo, luego el texto nuevo con sus líneas en verde.
  useEffect(() => {
    if (!diff) {
      setSequence(null);
      return;
    }
    const changes = diffLines(diff.before, diff.after);
    setSequence({ step: "mark", diff, changes });
    onSequenceChangeRef.current(true);
    const settleTimer = setTimeout(() => setSequence({ step: "settle", diff, changes }), GHOST_DIFF_MARK_MS);
    const endTimer = setTimeout(() => {
      setSequence(null);
      onSequenceChangeRef.current(false);
    }, GHOST_DIFF_MARK_MS + GHOST_DIFF_SETTLE_MS);
    return () => {
      clearTimeout(settleTimer);
      clearTimeout(endTimer);
      onSequenceChangeRef.current(false);
    };
  }, [diff]);

  const text = sequence ? (sequence.step === "mark" ? sequence.diff.before : sequence.diff.after) : code;
  const lines = useMemo(() => text.split("\n"), [text]);
  const lastLine = lines.length - 1;
  const isScanning = mode === "scan" && !sequence;

  useEffect(() => {
    if (!isScanning) return;
    setScanLine(0);
    const timer = setInterval(() => setScanLine(line => Math.min(line + 1, lastLine)), GHOST_SCAN_STEP_MS);
    return () => clearInterval(timer);
  }, [isScanning, lastLine]);

  const tones = new Map<number, LineTone>();
  if (sequence) {
    const changed = sequence.step === "mark" ? sequence.changes.removed : sequence.changes.added;
    for (const line of changed) tones.set(line, sequence.step === "mark" ? "error" : "added");
  } else if (mode === "scan") {
    tones.set(Math.min(scanLine, lastLine), "scan");
  } else if (mode === "error") {
    const affected = errorLines.filter(line => line <= lastLine);
    for (const line of affected.length ? affected : [Math.min(scanLine, lastLine)]) tones.set(line, "error");
  }
  const focusLine = tones.size ? Math.min(...tones.keys()) : undefined;

  useEffect(() => {
    const pre = preRef.current;
    if (!pre) return;
    if (focusLine === undefined) {
      if (mode === "stream") pre.scrollTop = pre.scrollHeight;
      return;
    }
    const line = pre.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
    if (line) pre.scrollTop = line.offsetTop - (pre.clientHeight - line.offsetHeight) / 2;
  }, [focusLine, mode, text]);

  return (
    <pre ref={preRef} className={`ghost-code ${mode === "stream" ? "" : "is-tracing"}`} aria-hidden="true">
      <code>{lines.map((line, index) => <GhostLine key={index} index={index} text={line} tone={tones.get(index)} />)}</code>
    </pre>
  );
}
