import { FormEvent, useCallback, useEffect, useState } from "react";
import type { AuthState } from "../types";

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/status", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { authenticated?: boolean };
        setAuthState(data.authenticated ? "authenticated" : "locked");
      })
      .catch((statusError: unknown) => {
        if (statusError instanceof DOMException && statusError.name === "AbortError") return;
        setAuthError("No se pudo conectar con el servidor. Inténtalo de nuevo.");
        setAuthState("locked");
      });
    return () => controller.abort();
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || isAuthenticating) return;
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo verificar la contraseña.");
      setPassword("");
      setAuthState("authenticated");
    } catch (caughtError) {
      setAuthError(caughtError instanceof Error ? caughtError.message : "Ocurrió un error inesperado.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  const lock = useCallback((message: string) => {
    setPassword("");
    setAuthError(message);
    setAuthState("locked");
  }, []);

  return { authState, password, setPassword, authError, isAuthenticating, login, lock };
}
