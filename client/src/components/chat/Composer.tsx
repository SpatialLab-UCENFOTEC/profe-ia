import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { Icon } from "../Icon";

export function Composer({
  input,
  isLoading,
  error,
  textareaRef,
  onInputChange,
  onSend,
  onDismissError,
}: {
  input: string;
  isLoading: boolean;
  error: string | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onDismissError: () => void;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <div className="composer-wrap">
      {error && <div role="alert" className="error-banner"><span>{error}</span><button onClick={onDismissError} aria-label="Cerrar aviso">✕</button></div>}
      <form onSubmit={handleSubmit} className="composer">
        <textarea ref={textareaRef} placeholder="Describe una experiencia o pide un cambio…" rows={1} maxLength={8000} value={input} onChange={(event) => onInputChange(event.target.value)} onKeyDown={handleKeyDown} disabled={isLoading} aria-label="Mensaje" />
        <button type="submit" className="send-button" disabled={isLoading || !input.trim()} aria-label="Enviar mensaje"><Icon name="send" /></button>
      </form>
      <p>Enter para enviar · Shift + Enter para nueva línea</p>
    </div>
  );
}
