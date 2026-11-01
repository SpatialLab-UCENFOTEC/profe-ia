export function TopBar({ showOpenPreview, onOpenPreview }: { showOpenPreview: boolean; onOpenPreview: () => void }) {
  return (
    <header className="topbar">
      <a className="brand-mark" href="/" aria-label="Volver al inicio de ProfeIA" title="Volver al inicio"><img src="/university-logo.png" alt="Logo de la universidad" /></a>
      <div className="brand-copy"><h1>ProfeIA</h1><p>Construye mundos WebXR conversando</p></div>
      {showOpenPreview && <button className="btn btn-sm btn-outline ml-auto" onClick={onOpenPreview}>Abrir experiencia</button>}
      <div className="connection-status"><span />Conectado con LLM</div>
    </header>
  );
}
