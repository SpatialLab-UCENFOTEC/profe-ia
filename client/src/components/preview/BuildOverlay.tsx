import type { GhostDiff, PreviewStatus } from "../../types";
import { GhostCode, type GhostMode } from "./GhostCode";

const STATUS_TEXT: Partial<Record<PreviewStatus, string>> = {
  generating: "Generando experiencia...",
  patching: "Modificando Experiencia",
  repairing: "Perfeccionando Experiencia",
  "repair-failed": "No se pudo validar la experiencia",
};

const STATUS_TONE: Partial<Record<PreviewStatus, string>> = {
  patching: "tone-patch",
  repairing: "tone-repair",
};

function ghostMode(previewStatus: PreviewStatus, isStreamingCode: boolean): GhostMode {
  if (isStreamingCode) return "stream";
  if (previewStatus === "repairing" || previewStatus === "repair-failed") return "error";
  if (previewStatus === "patching") return "plain";
  return "scan";
}

export function BuildOverlay({
  previewStatus,
  isStreamingCode,
  ghostCode,
  ghostDiff,
  errorLines,
  onSequenceChange,
}: {
  previewStatus: PreviewStatus;
  isStreamingCode: boolean;
  ghostCode: string;
  ghostDiff: GhostDiff | null;
  errorLines: number[];
  onSequenceChange: (active: boolean) => void;
}) {
  // "ready"/"idle" solo se ven aquí mientras termina la animación de un parche: se muestran como revisión.
  const text = STATUS_TEXT[previewStatus] ?? "Comprobando que todo funcione…";

  return (
    <div className={`build-overlay ${STATUS_TONE[previewStatus] ?? ""}`} role="status" aria-live="polite">
      <div className="liquid-lens"><span /><span /><span /></div>
      {ghostCode && <GhostCode code={ghostCode} mode={ghostMode(previewStatus, isStreamingCode)} diff={ghostDiff} errorLines={errorLines} onSequenceChange={onSequenceChange} />}
      <div className="build-status">
        {previewStatus !== "repair-failed" && <div className="build-sweep" aria-hidden="true" />}
        <strong>{text}</strong>
        {(previewStatus === "checking" || previewStatus === "repair-failed") && <small>{previewStatus === "checking" ? "La interacción se habilitará al terminar el chequeo" : "Puedes recargar para volver a comprobar o solicitar un cambio"}</small>}
      </div>
    </div>
  );
}
