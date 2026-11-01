import type { FormEvent } from "react";

export function AccessScreen({
  password,
  error,
  isSubmitting,
  onPasswordChange,
  onSubmit,
}: {
  password: string;
  error: string | null;
  isSubmitting: boolean;
  onPasswordChange: (password: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="access-shell">
      <div className="orb orb-one" /><div className="orb orb-two" />
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-logo"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
        <p className="eyebrow">SpatialLab</p>
        <h1 id="access-title">Acceso a ProfeIA</h1>
        <p className="access-description">Ingresa la contraseña para comenzar a construir experiencias WebXR.</p>
        <form onSubmit={onSubmit} className="access-form">
          <label htmlFor="access-password">Contraseña</label>
          <input
            id="access-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            disabled={isSubmitting}
          />
          {error && <p role="alert" className="access-error">{error}</p>}
          <button type="submit" disabled={isSubmitting || !password}>
            {isSubmitting ? "Verificando…" : "Ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}
