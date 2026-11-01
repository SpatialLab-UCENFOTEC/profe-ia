import type { RefObject } from "react";
import type { PreviewMode, PreviewStatus } from "../../types";
import { Icon } from "../Icon";
import { BuildOverlay } from "./BuildOverlay";

export function PreviewPanel({
  previewMode,
  previewStatus,
  statusLabel,
  isBuilding,
  streamingHtml,
  html,
  iframeKey,
  iframeRef,
  fatalCount,
  canDownload,
  onLoad,
  onReload,
  onDownload,
  onModeChange,
}: {
  previewMode: PreviewMode;
  previewStatus: PreviewStatus;
  statusLabel: string;
  isBuilding: boolean;
  streamingHtml: string | null;
  html: string;
  iframeKey: number;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  fatalCount: number;
  canDownload: boolean;
  onLoad: () => void;
  onReload: () => void;
  onDownload: () => void;
  onModeChange: (mode: PreviewMode) => void;
}) {
  return (
    <aside className={`preview-panel ${previewMode === "fullscreen" ? "fullscreen" : ""}`} aria-label="Vista previa WebXR">
      <div className="preview-toolbar">
        <div><span className={previewStatus === "ready" ? "live-dot" : "live-dot pulsing"} /><strong>{statusLabel}</strong></div>
        <div className="toolbar-actions">
          <button onClick={onReload} title="Recargar preview" aria-label="Recargar preview"><Icon name="reload" /></button>
          <button onClick={onDownload} disabled={!canDownload} title="Descargar HTML" aria-label="Descargar HTML"><Icon name="download" /></button>
          <button onClick={() => onModeChange("fullscreen")} title="Ver por completo" aria-label="Ver por completo"><Icon name="expand" /></button>
          <button onClick={() => onModeChange("closed")} className="close-preview" aria-label="Cerrar preview">✕</button>
        </div>
      </div>
      <div className={`preview-stage ${isBuilding ? "is-building" : ""}`}>
        {html ? (
          <iframe ref={iframeRef} key={iframeKey} title="Experiencia WebXR generada" srcDoc={html} onLoad={onLoad} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" />
        ) : (
          <div className="preview-placeholder" aria-hidden="true"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
        )}
        {isBuilding && <BuildOverlay previewStatus={previewStatus} streamingHtml={streamingHtml} fatalCount={fatalCount} />}
      </div>
      {previewMode === "fullscreen" && <button className="floating-back" onClick={() => onModeChange("split")}><Icon name="back" /> Volver al chat</button>}
    </aside>
  );
}
