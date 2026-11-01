import { SUGGESTIONS } from "../../constants";

export function WelcomeScreen({ onSuggestion }: { onSuggestion: (suggestion: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-icon"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
      <p className="eyebrow">SpatialLab</p>
      <h2>Describe el mundo que quieres crear</h2>
      <p>ProfeIA escribe la experiencia, te explica cada decisión y la muestra mientras se está construyendo.</p>
      <div className="suggestions">{SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => onSuggestion(suggestion)}>{suggestion}</button>)}</div>
    </div>
  );
}
