import type { LlmProviderInfo } from "../types";

export interface ProviderPickerProps {
  providers: LlmProviderInfo[];
  selected?: string;
  disabled?: boolean;
  onSelect: (id: string) => void;
}

function ProviderPicker({ providers, selected, disabled, onSelect }: ProviderPickerProps) {
  const current = providers.find((provider) => provider.id === selected);
  if (providers.length <= 1) {
    return <div className="connection-status"><span />{current ? `Conectado con ${current.label}` : "Conectado con LLM"}</div>;
  }
  return (
    <label className="connection-status provider-picker" title="Modelo de lenguaje que responderá">
      <span />
      <select value={selected} disabled={disabled} onChange={(event) => onSelect(event.target.value)} aria-label="Modelo de lenguaje">
        {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
      </select>
    </label>
  );
}

export function TopBar({ showOpenPreview, onOpenPreview, providerPicker }: {
  showOpenPreview: boolean;
  onOpenPreview: () => void;
  providerPicker: ProviderPickerProps;
}) {
  return (
    <header className="topbar">
      <a className="brand-mark" href="/" aria-label="Volver al inicio de ProfeIA" title="Volver al inicio"><img src="/university-logo.png" alt="Logo de la universidad" /></a>
      <div className="brand-copy"><h1>ProfeIA</h1><p>Construye mundos WebXR conversando</p></div>
      {showOpenPreview && <button className="btn btn-sm btn-outline ml-auto" onClick={onOpenPreview}>Abrir experiencia</button>}
      <ProviderPicker {...providerPicker} />
    </header>
  );
}
