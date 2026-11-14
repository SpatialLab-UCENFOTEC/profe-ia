import { useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { GhostDiff, PreviewMode, PreviewStatus } from "../../types";
import { Icon } from "../Icon";
import { BuildOverlay } from "./BuildOverlay";
import { exit, heavy, jumpy, popIn } from "../../motion";

const toolTap = { whileHover: { y: -2, transition: jumpy }, whileTap: { scale: 0.85, transition: jumpy } } as const;

export function PreviewPanel({
  previewMode,
  previewStatus,
  statusLabel,
  isBuilding,
  isStreamingCode,
  ghostCode,
  ghostDiff,
  errorLines,
  html,
  iframeKey,
  iframeRef,
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
  isStreamingCode: boolean;
  ghostCode: string;
  ghostDiff: GhostDiff | null;
  errorLines: number[];
  html: string;
  iframeKey: number;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  canDownload: boolean;
  onLoad: () => void;
  onReload: () => void;
  onDownload: () => void;
  onModeChange: (mode: PreviewMode) => void;
}) {
  // Si la experiencia queda lista en medio de la animación de un parche, el overlay espera a que termine.
  const [isSequenceActive, setIsSequenceActive] = useState(false);
  const showOverlay = isBuilding || isSequenceActive;
  // En pantallas angostas el panel cubre todo: entra desde abajo en vez de desde la derecha.
  const [isNarrow] = useState(() => window.matchMedia("(max-width: 850px)").matches);
  const offscreen = isNarrow ? { y: "40%", opacity: 0 } : { x: 120, opacity: 0 };

  return (
    <motion.aside
      className={`preview-panel ${previewMode === "fullscreen" ? "fullscreen" : ""}`}
      aria-label="Vista previa WebXR"
      initial={offscreen}
      animate={{ x: 0, y: 0, opacity: 1 }}
      exit={{ ...offscreen, transition: exit }}
      transition={{ ...heavy, opacity: { duration: 0.2 } }}
    >
      <div className="preview-toolbar">
        <div><span className={previewStatus === "ready" ? "live-dot" : "live-dot pulsing"} /><strong>{statusLabel}</strong></div>
        <div className="toolbar-actions">
          <motion.button {...toolTap} onClick={onReload} title="Recargar preview" aria-label="Recargar preview"><Icon name="reload" /></motion.button>
          <motion.button {...toolTap} onClick={onDownload} disabled={!canDownload} title="Descargar HTML" aria-label="Descargar HTML"><Icon name="download" /></motion.button>
          <motion.button {...toolTap} onClick={() => onModeChange("fullscreen")} title="Ver por completo" aria-label="Ver por completo"><Icon name="expand" /></motion.button>
          <motion.button {...toolTap} onClick={() => onModeChange("closed")} className="close-preview" aria-label="Cerrar preview">✕</motion.button>
        </div>
      </div>
      <div className={`preview-stage ${showOverlay ? "is-building" : ""}`}>
        {html ? (
          <iframe ref={iframeRef} key={iframeKey} title="Experiencia WebXR generada" srcDoc={html} onLoad={onLoad} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" />
        ) : (
          <div className="preview-placeholder" aria-hidden="true"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
        )}
        <AnimatePresence>
          {showOverlay && <BuildOverlay key="overlay" previewStatus={previewStatus} isStreamingCode={isStreamingCode} ghostCode={ghostCode} ghostDiff={ghostDiff} errorLines={errorLines} onSequenceChange={setIsSequenceActive} />}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {previewMode === "fullscreen" && (
          <motion.button key="back" className="floating-back" onClick={() => onModeChange("split")} variants={popIn} initial="hidden" animate="show" exit="exit" {...toolTap}>
            <Icon name="back" /> Volver al chat
          </motion.button>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
