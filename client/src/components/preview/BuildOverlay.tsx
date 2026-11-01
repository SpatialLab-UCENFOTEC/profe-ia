import { useEffect, useRef } from "react";
import type { PreviewStatus } from "../../types";

export function BuildOverlay({
  previewStatus,
  streamingHtml,
  fatalCount,
}: {
  previewStatus: PreviewStatus;
  streamingHtml: string | null;
  fatalCount: number;
}) {
  const ghostCodeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (ghostCodeRef.current) ghostCodeRef.current.scrollTop = ghostCodeRef.current.scrollHeight;
  }, [streamingHtml]);

  return (
    <div className="build-overlay" role="status" aria-live="polite">
      <div className="liquid-lens"><span /><span /><span /></div>
      {streamingHtml && <pre ref={ghostCodeRef} className="ghost-code" aria-hidden="true"><code>{streamingHtml}</code></pre>}
      <div className="build-status">
        {previewStatus !== "repair-failed" && <div className="build-spinner" />}
        <strong>{previewStatus === "repairing" ? "Corrigiendo la experiencia…" : previewStatus === "checking" ? "Comprobando que todo funcione…" : previewStatus === "repair-failed" ? "No se pudo validar la experiencia" : "Generando el código…"}</strong>
        <small>{previewStatus === "repairing" ? `${fatalCount} error(es) detectado(s)` : previewStatus === "checking" ? "La interacción se habilitará al terminar el chequeo" : previewStatus === "repair-failed" ? "Puedes recargar para volver a comprobar o solicitar un cambio" : "La experiencia se está armando en segundo plano"}</small>
      </div>
    </div>
  );
}
