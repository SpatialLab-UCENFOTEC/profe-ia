import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeCollapsibleHeadings } from "./collapsibleHeadings";
import { WebXrStreamParser, isCompleteHtmlDocument } from "./streamParser";
import { classifyPreviewDiagnostic, errorsPrompt, type ClassifiedDiagnostic, type PreviewDiagnostic } from "./previewDiagnostics";

type Role = "user" | "model";
type PreviewMode = "closed" | "split" | "fullscreen";
type AuthState = "checking" | "locked" | "authenticated";

interface Message {
  id: string;
  role: Role;
  content: string;
  html?: string;
  internal?: boolean;
  corrections?: string[];
}

type PreviewStatus = "idle" | "generating" | "checking" | "ready" | "repairing" | "repair-failed";

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "final"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SUGGESTIONS = [
  "Crea un sistema solar interactivo en WebXR",
  "Diseña una galería virtual con A-Frame",
  "Haz un juego de bloques 3D con Three.js",
];
const MAX_CONTEXT_MESSAGES = 30;
const MAX_REPAIR_ATTEMPTS = 2;
const PREVIEW_STARTUP_TIMEOUT_MS = 12_000;

function Icon({ name }: { name: "send" | "expand" | "download" | "reload" | "back" }) {
  const paths = {
    send: <><path d="m4 12 16-8-6.2 16-2.4-6.4L4 12Z" /><path d="m11.4 13.6 3.7-3.7" /></>,
    expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><path d="m3 8 6-6m12 6-6-6M3 16l6 6m12-6-6 6" /></>,
    download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5" /><path d="M5 20h14" /></>,
    reload: <><path d="M20 7v5h-5" /><path d="M19 12a7 7 0 1 0-2 5" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Markdown({ children, collapsible = false }: { children: string; collapsible?: boolean }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={collapsible ? [rehypeCollapsibleHeadings] : []}>{children}</ReactMarkdown></div>;
}

function TechnicalDetailsIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5 5L4 17v3h3l5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z" /><path d="m6 18 1 1" /></svg>;
}

function AccessScreen({
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

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [currentHtml, setCurrentHtml] = useState("");
  const [lastCompletedHtml, setLastCompletedHtml] = useState("");
  const [streamingHtml, setStreamingHtml] = useState<string | null>(null);
  const [streamingSummary, setStreamingSummary] = useState("");
  const [isPreviewBuilding, setIsPreviewBuilding] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("closed");
  const [iframeKey, setIframeKey] = useState(0);
  const [previewRunId, setPreviewRunId] = useState(crypto.randomUUID());
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [previewDiagnostics, setPreviewDiagnostics] = useState<ClassifiedDiagnostic[]>([]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ghostCodeRef = useRef<HTMLPreElement>(null);
  const awaitingFinalLoadRef = useRef(false);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repairTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const repairAttemptRef = useRef(0);
  const diagnosticSignaturesRef = useRef(new Set<string>());
  const fatalDiagnosticsRef = useRef<ClassifiedDiagnostic[]>([]);
  const currentCandidateRef = useRef("");
  const pendingMessageIdRef = useRef<string | undefined>(undefined);
  const originalMessageIdRef = useRef<string | undefined>(undefined);
  const correctionResponsesRef = useRef<string[]>([]);
  const handleDiagnosticRef = useRef<(diagnostic: PreviewDiagnostic) => void>(() => undefined);

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingSummary, isLoading]);

  useEffect(() => {
    if (ghostCodeRef.current) ghostCodeRef.current.scrollTop = ghostCodeRef.current.scrollHeight;
  }, [streamingHtml]);

  useEffect(() => () => {
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    if (repairTimerRef.current) clearTimeout(repairTimerRef.current);
  }, []);

  const processStream = async (response: Response, nextMessages: Message[], isRepair = false) => {
    if (!response.body) throw new Error("El navegador no pudo abrir la respuesta incremental.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new WebXrStreamParser();
    let lineBuffer = "";
    let completed = false;
    let buildingStarted = false;
    let committedHtml = "";
    let finalizedResult: ReturnType<WebXrStreamParser["finish"]> | undefined;
    let finalMessageStored = false;
    let storedMessageId: string | undefined;

    const commitCompletedHtml = (html: string) => {
      if (committedHtml || !isCompleteHtmlDocument(html)) return;
      committedHtml = html.trim();
      currentCandidateRef.current = committedHtml;
      diagnosticSignaturesRef.current.clear();
      fatalDiagnosticsRef.current = [];
      setPreviewDiagnostics([]);
      setPreviewStatus("checking");
      if (!isRepair) {
        repairAttemptRef.current = 0;
        correctionResponsesRef.current = [];
      }
      const nextRunId = crypto.randomUUID();
      setPreviewRunId(nextRunId);
      awaitingFinalLoadRef.current = true;
      setCurrentHtml(committedHtml);
      setIframeKey((key) => key + 1);
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = setTimeout(() => {
        handleDiagnosticRef.current({ type: "startup-timeout", details: {} });
      }, PREVIEW_STARTUP_TIMEOUT_MS);
    };

    const updateParsedContent = (text: string) => {
      const parsed = parser.push(text);
      if (parsed.hasHtml) {
        if (!committedHtml) setStreamingHtml(parsed.html);
        setPreviewMode((mode) => mode === "closed" ? "split" : mode);
        if (!buildingStarted) {
          buildingStarted = true;
          setPreviewStatus("generating");
          setIsPreviewBuilding(true);
        }
      }
      if (parsed.hasResponse) setStreamingSummary(parsed.response);
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "delta") updateParsedContent(event.text);
      if (event.type === "final") {
        const finalParser = new WebXrStreamParser();
        finalParser.push(event.text);
        finalizedResult = finalParser.finish();
        const modelMessage: Message = {
          id: crypto.randomUUID(),
          role: "model",
          content: finalizedResult.response,
          html: finalizedResult.html,
          internal: Boolean(finalizedResult.html),
        };
        storedMessageId = modelMessage.id;
        if (finalizedResult.html && !isRepair) originalMessageIdRef.current = modelMessage.id;
        if (finalizedResult.html && isRepair) correctionResponsesRef.current.push(finalizedResult.response);
        pendingMessageIdRef.current = finalizedResult.html ? modelMessage.id : undefined;
        setMessages([...nextMessages, modelMessage]);
        finalMessageStored = true;
        if (finalizedResult.html) commitCompletedHtml(finalizedResult.html);
        if (finalizedResult.response) setStreamingSummary(finalizedResult.response);
      }
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") completed = true;
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        lineBuffer += decoder.decode(value, { stream: !done });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
        if (done) break;
      }
      if (lineBuffer.trim()) handleLine(lineBuffer);
      if (!completed) throw new Error("La conexión terminó antes de completar la respuesta.");

      if (!finalizedResult) throw new Error("El servidor no confirmó la versión final de la experiencia.");
      const result = finalizedResult;
      setStreamingSummary("");
      if (!finalMessageStored) {
        setMessages([...nextMessages, { id: crypto.randomUUID(), role: "model", content: result.response, html: result.html }]);
      }
    } catch (streamError) {
      if (!committedHtml) {
        awaitingFinalLoadRef.current = false;
        setIsPreviewBuilding(false);
      }
      setCurrentHtml(committedHtml || lastCompletedHtml);
      setStreamingHtml(null);
      setStreamingSummary("");
      if (storedMessageId) {
        const failedMessageId = storedMessageId;
        setMessages(previous => previous.filter(message => message.id !== failedMessageId));
        if (pendingMessageIdRef.current === failedMessageId) {
          pendingMessageIdRef.current = originalMessageIdRef.current === failedMessageId
            ? undefined
            : originalMessageIdRef.current;
        }
        if (originalMessageIdRef.current === failedMessageId) originalMessageIdRef.current = undefined;
      }
      throw streamError;
    }
  };

  const sendMessage = async (
    content: string,
    options: { internal?: boolean; currentHtml?: string; isRepair?: boolean } = {},
  ) => {
    const cleanContent = content.trim();
    if (!cleanContent || isLoadingRef.current) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: cleanContent, internal: options.internal };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setStreamingHtml(null);
    setStreamingSummary("");
    setIsLoading(true);
    isLoadingRef.current = true;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-MAX_CONTEXT_MESSAGES).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          currentHtml: options.currentHtml || lastCompletedHtml || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        if (response.status === 401) {
          setPassword("");
          setAuthError(data.error || "Tu sesión venció. Ingresa la contraseña nuevamente.");
          setAuthState("locked");
        }
        throw new Error(data.error || "No se pudo completar la solicitud.");
      }
      await processStream(response, nextMessages, options.isRepair);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ocurrió un error inesperado.");
      if (options.isRepair) setPreviewStatus("repair-failed");
    } finally {
      setIsLoading(false);
      isLoadingRef.current = false;
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  handleDiagnosticRef.current = (diagnostic: PreviewDiagnostic) => {
    const classified = classifyPreviewDiagnostic(diagnostic);
    if (classified.severity === "ignored") return;
    if (diagnosticSignaturesRef.current.has(classified.signature)) return;
    diagnosticSignaturesRef.current.add(classified.signature);
    setPreviewDiagnostics(previous => [...previous, classified]);

    if (classified.severity === "ready") {
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      const candidateAtReady = currentCandidateRef.current;
      setTimeout(() => {
        if (currentCandidateRef.current !== candidateAtReady) return;
        if (fatalDiagnosticsRef.current.length > 0) return;
        setLastCompletedHtml(currentCandidateRef.current);
        setPreviewStatus("ready");
        setIsPreviewBuilding(false);
        setStreamingHtml(null);
        repairAttemptRef.current = 0;
        const finalMessageId = originalMessageIdRef.current ?? pendingMessageIdRef.current;
        const corrections = [...correctionResponsesRef.current];
        if (finalMessageId) {
          setMessages(previous => previous.map(message => message.id === finalMessageId
            ? { ...message, internal: false, html: currentCandidateRef.current, corrections }
            : message));
        }
        pendingMessageIdRef.current = undefined;
        originalMessageIdRef.current = undefined;
      }, 900);
      return;
    }

    if (classified.severity !== "fatal") return;
    fatalDiagnosticsRef.current.push(classified);
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    if (repairAttemptRef.current >= MAX_REPAIR_ATTEMPTS) {
      setPreviewStatus("repair-failed");
      setIsPreviewBuilding(true);
      setError("La experiencia sigue presentando errores después de dos intentos automáticos. Revisa los detalles o solicita un cambio manual.");
      return;
    }
    setPreviewStatus("repairing");
    setIsPreviewBuilding(true);
    if (repairTimerRef.current) clearTimeout(repairTimerRef.current);
    repairTimerRef.current = setTimeout(() => {
      repairTimerRef.current = undefined;
      repairAttemptRef.current += 1;
      const prompt = errorsPrompt(fatalDiagnosticsRef.current);
      void sendMessage(prompt, {
        internal: true,
        currentHtml: currentCandidateRef.current,
        isRepair: true,
      });
    }, 700);
  };

  useEffect(() => {
    const receivePreviewDiagnostic = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as Partial<PreviewDiagnostic> & { namespace?: string; runId?: string };
      if (!data || data.namespace !== "profeia-preview" || data.runId !== previewRunId) return;
      if (typeof data.type !== "string" || !data.details || typeof data.details !== "object") return;
      handleDiagnosticRef.current({ type: data.type as PreviewDiagnostic["type"], details: data.details });
    };
    window.addEventListener("message", receivePreviewDiagnostic);
    return () => window.removeEventListener("message", receivePreviewDiagnostic);
  }, [previewRunId]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleAccessSubmit = async (event: FormEvent) => {
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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const downloadHtml = () => {
    if (!lastCompletedHtml) return;
    const url = URL.createObjectURL(new Blob([lastCompletedHtml], { type: "text/html;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "experiencia-webxr.html";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handlePreviewLoaded = () => {
    if (!awaitingFinalLoadRef.current) return;
    awaitingFinalLoadRef.current = false;
  };

  const reloadPreview = () => {
    diagnosticSignaturesRef.current.clear();
    fatalDiagnosticsRef.current = [];
    setPreviewDiagnostics([]);
    setPreviewStatus("checking");
    setIsPreviewBuilding(true);
    const nextRunId = crypto.randomUUID();
    setPreviewRunId(nextRunId);
    setIframeKey(key => key + 1);
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    previewTimeoutRef.current = setTimeout(() => {
      handleDiagnosticRef.current({ type: "startup-timeout", details: {} });
    }, PREVIEW_STARTUP_TIMEOUT_MS);
  };

  const previewHtml = currentHtml || lastCompletedHtml;
  const instrumentedPreviewHtml = previewHtml.replaceAll("__PROFEIA_PREVIEW_RUN_ID__", previewRunId);
  const isPreviewVisible = previewMode !== "closed" && (Boolean(previewHtml) || isPreviewBuilding);
  const visibleMessages = messages.filter(message => !message.internal);
  const previewStatusLabel = previewStatus === "repairing"
    ? `Corrigiendo errores (${Math.min(repairAttemptRef.current + 1, MAX_REPAIR_ATTEMPTS)}/${MAX_REPAIR_ATTEMPTS})`
    : previewStatus === "generating"
      ? "Generando código"
      : previewStatus === "checking"
        ? "Comprobando experiencia"
      : previewStatus === "repair-failed"
        ? "Revisión manual necesaria"
        : isPreviewBuilding ? "Construyendo" : "Experiencia lista";

  if (authState === "checking") {
    return <main className="access-shell"><div className="access-loader" role="status" aria-label="Verificando acceso" /></main>;
  }

  if (authState === "locked") {
    return <AccessScreen password={password} error={authError} isSubmitting={isAuthenticating} onPasswordChange={setPassword} onSubmit={handleAccessSubmit} />;
  }

  return (
    <main className="app-shell">
      <div className="orb orb-one" /><div className="orb orb-two" />
      <section className={`chat-pane ${isPreviewVisible ? "with-preview" : ""}`}>
        <header className="topbar">
          <a className="brand-mark" href="/" aria-label="Volver al inicio de ProfeIA" title="Volver al inicio"><img src="/university-logo.png" alt="Logo de la universidad" /></a>
          <div className="brand-copy"><h1>ProfeIA</h1><p>Construye mundos WebXR conversando</p></div>
          {lastCompletedHtml && previewMode === "closed" && <button className="btn btn-sm btn-outline ml-auto" onClick={() => setPreviewMode("split")}>Abrir experiencia</button>}
          <div className="connection-status"><span />Conectado con LLM</div>
        </header>

        <div className="conversation">
          {visibleMessages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
              <p className="eyebrow">SpatialLab</p>
              <h2>Describe el mundo que quieres crear</h2>
              <p>ProfeIA escribe la experiencia, te explica cada decisión y la muestra mientras se está construyendo.</p>
              <div className="suggestions">{SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {visibleMessages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-label">{message.role === "user" ? "Tú" : "ProfeIA"}</div>
                  <div className="message-card">
                    {message.html && <details className="code-disclosure"><summary>HTML generado <span>{message.html.length.toLocaleString()} caracteres</span></summary><pre><code>{message.html}</code></pre></details>}
                    <Markdown collapsible={message.role === "model"}>{message.content}</Markdown>
                    {message.corrections && message.corrections.length > 0 && <details className="corrections-disclosure">
                      <summary><TechnicalDetailsIcon /><span>Detalles técnicos de las correcciones</span><small>{message.corrections.length}</small></summary>
                      <div className="corrections-list">{message.corrections.map((correction, index) => <section key={`${index}-${correction}`}><strong>Corrección {index + 1}</strong><Markdown>{correction}</Markdown></section>)}</div>
                    </details>}
                  </div>
                </article>
              ))}
              {isLoading && <article className="message model"><div className="message-label">ProfeIA</div><div className="message-card streaming-card">{streamingHtml && <details className="code-disclosure"><summary>Generando HTML…</summary><pre><code>{streamingHtml}</code></pre></details>}{streamingSummary ? <Markdown collapsible>{streamingSummary}</Markdown> : <div className="typing"><i /><i /><i /></div>}</div></article>}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div role="alert" className="error-banner"><span>{error}</span><button onClick={() => setError(null)} aria-label="Cerrar aviso">✕</button></div>}
          <form onSubmit={handleSubmit} className="composer">
            <textarea ref={textareaRef} placeholder="Describe una experiencia o pide un cambio…" rows={1} maxLength={8000} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} disabled={isLoading} aria-label="Mensaje" />
            <button type="submit" className="send-button" disabled={isLoading || !input.trim()} aria-label="Enviar mensaje"><Icon name="send" /></button>
          </form>
          <p>Enter para enviar · Shift + Enter para nueva línea</p>
        </div>
      </section>

      {isPreviewVisible && <aside className={`preview-panel ${previewMode === "fullscreen" ? "fullscreen" : ""}`} aria-label="Vista previa WebXR">
        <div className="preview-toolbar">
          <div><span className={previewStatus === "ready" ? "live-dot" : "live-dot pulsing"} /><strong>{previewStatusLabel}</strong></div>
          <div className="toolbar-actions">
            <button onClick={reloadPreview} title="Recargar preview" aria-label="Recargar preview"><Icon name="reload" /></button>
            <button onClick={downloadHtml} disabled={!lastCompletedHtml} title="Descargar HTML" aria-label="Descargar HTML"><Icon name="download" /></button>
            <button onClick={() => setPreviewMode("fullscreen")} title="Ver por completo" aria-label="Ver por completo"><Icon name="expand" /></button>
            <button onClick={() => setPreviewMode("closed")} className="close-preview" aria-label="Cerrar preview">✕</button>
          </div>
        </div>
        <div className={`preview-stage ${isPreviewBuilding ? "is-building" : ""}`}>
          {previewHtml ? (
            <iframe ref={iframeRef} key={iframeKey} title="Experiencia WebXR generada" srcDoc={instrumentedPreviewHtml} onLoad={handlePreviewLoaded} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" />
          ) : (
            <div className="preview-placeholder" aria-hidden="true"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
          )}
          {isPreviewBuilding && <div className="build-overlay" role="status" aria-live="polite">
            <div className="liquid-lens"><span /><span /><span /></div>
            {streamingHtml && <pre ref={ghostCodeRef} className="ghost-code" aria-hidden="true"><code>{streamingHtml}</code></pre>}
            <div className="build-status">
              {previewStatus !== "repair-failed" && <div className="build-spinner" />}
              <strong>{previewStatus === "repairing" ? "Corrigiendo la experiencia…" : previewStatus === "checking" ? "Comprobando que todo funcione…" : previewStatus === "repair-failed" ? "No se pudo validar la experiencia" : "Generando el código…"}</strong>
              <small>{previewStatus === "repairing" ? `${previewDiagnostics.filter(item => item.severity === "fatal").length} error(es) detectado(s)` : previewStatus === "checking" ? "La interacción se habilitará al terminar el chequeo" : previewStatus === "repair-failed" ? "Puedes recargar para volver a comprobar o solicitar un cambio" : "La experiencia se está armando en segundo plano"}</small>
            </div>
          </div>}
        </div>
        {previewMode === "fullscreen" && <button className="floating-back" onClick={() => setPreviewMode("split")}><Icon name="back" /> Volver al chat</button>}
      </aside>}
    </main>
  );
}
