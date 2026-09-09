import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { WebXrStreamParser, isCompleteHtmlDocument } from "./streamParser";

type Role = "user" | "model";
type PreviewMode = "closed" | "split" | "fullscreen";

interface Message {
  id: string;
  role: Role;
  content: string;
  html?: string;
}

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const SUGGESTIONS = [
  "Crea un sistema solar interactivo en WebXR",
  "Diseña una galería virtual con A-Frame",
  "Haz un juego de bloques 3D con Three.js",
];
const MAX_CONTEXT_MESSAGES = 30;

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

function Markdown({ children }: { children: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown></div>;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentHtml, setCurrentHtml] = useState("");
  const [lastCompletedHtml, setLastCompletedHtml] = useState("");
  const [streamingHtml, setStreamingHtml] = useState<string | null>(null);
  const [streamingSummary, setStreamingSummary] = useState("");
  const [isPreviewBuilding, setIsPreviewBuilding] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("closed");
  const [iframeKey, setIframeKey] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ghostCodeRef = useRef<HTMLPreElement>(null);
  const buildStartedAtRef = useRef(0);
  const awaitingFinalLoadRef = useRef(false);
  const buildFinishTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingSummary, isLoading]);

  useEffect(() => {
    if (ghostCodeRef.current) ghostCodeRef.current.scrollTop = ghostCodeRef.current.scrollHeight;
  }, [streamingHtml]);

  useEffect(() => () => {
    if (buildFinishTimerRef.current) clearTimeout(buildFinishTimerRef.current);
  }, []);

  const processStream = async (response: Response, nextMessages: Message[]) => {
    if (!response.body) throw new Error("El navegador no pudo abrir la respuesta incremental.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new WebXrStreamParser();
    let lineBuffer = "";
    let completed = false;
    let buildingStarted = false;
    let committedHtml = "";

    const commitCompletedHtml = (html: string) => {
      if (committedHtml || !isCompleteHtmlDocument(html)) return;
      committedHtml = html.trim();
      awaitingFinalLoadRef.current = true;
      setCurrentHtml(committedHtml);
      setLastCompletedHtml(committedHtml);
      setIframeKey((key) => key + 1);
      buildFinishTimerRef.current = setTimeout(() => {
        awaitingFinalLoadRef.current = false;
        setIsPreviewBuilding(false);
        setStreamingHtml(null);
      }, 8000);
    };

    const updateParsedContent = (text: string) => {
      const parsed = parser.push(text);
      if (parsed.hasHtml) {
        if (!committedHtml) setStreamingHtml(parsed.html);
        setPreviewMode((mode) => mode === "closed" ? "split" : mode);
        if (!buildingStarted) {
          buildingStarted = true;
          if (buildFinishTimerRef.current) clearTimeout(buildFinishTimerRef.current);
          buildStartedAtRef.current = performance.now();
          setIsPreviewBuilding(true);
        }
        if (parsed.htmlComplete) commitCompletedHtml(parsed.html);
      }
      if (parsed.hasResponse) setStreamingSummary(parsed.response);
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "delta") updateParsedContent(event.text);
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

      const result = parser.finish();
      if (result.html) {
        commitCompletedHtml(result.html);
      }
      setStreamingSummary("");
      setMessages([
        ...nextMessages,
        { id: crypto.randomUUID(), role: "model", content: result.response, html: result.html },
      ]);
    } catch (streamError) {
      if (!committedHtml) {
        awaitingFinalLoadRef.current = false;
        if (buildFinishTimerRef.current) clearTimeout(buildFinishTimerRef.current);
        setIsPreviewBuilding(false);
      }
      setCurrentHtml(committedHtml || lastCompletedHtml);
      setStreamingHtml(null);
      setStreamingSummary("");
      throw streamError;
    }
  };

  const sendMessage = async (content: string) => {
    const cleanContent = content.trim();
    if (!cleanContent || isLoading) return;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: cleanContent };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setError(null);
    setStreamingHtml(null);
    setStreamingSummary("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-MAX_CONTEXT_MESSAGES).map(({ role, content: messageContent }) => ({ role, content: messageContent })),
          currentHtml: lastCompletedHtml || undefined,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "No se pudo completar la solicitud.");
      }
      await processStream(response, nextMessages);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Ocurrió un error inesperado.");
    } finally {
      setIsLoading(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
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
    const elapsed = performance.now() - buildStartedAtRef.current;
    const remaining = Math.max(350, 1100 - elapsed);
    if (buildFinishTimerRef.current) clearTimeout(buildFinishTimerRef.current);
    buildFinishTimerRef.current = setTimeout(() => {
      setIsPreviewBuilding(false);
      setStreamingHtml(null);
    }, remaining);
  };

  const previewHtml = currentHtml || lastCompletedHtml;
  const isPreviewVisible = previewMode !== "closed" && (Boolean(previewHtml) || isPreviewBuilding);

  return (
    <main className="app-shell">
      <div className="orb orb-one" /><div className="orb orb-two" />
      <section className={`chat-pane ${isPreviewVisible ? "with-preview" : ""}`}>
        <header className="topbar">
          <div className="brand-mark"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
          <div className="brand-copy"><h1>ProfeIA</h1><p>Construye mundos WebXR conversando</p></div>
          {lastCompletedHtml && previewMode === "closed" && <button className="btn btn-sm btn-outline ml-auto" onClick={() => setPreviewMode("split")}>Abrir experiencia</button>}
          <div className="connection-status"><span /> Gemini conectado</div>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-icon"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
              <p className="eyebrow">SpatialLab</p>
              <h2>Describe el mundo que quieres crear</h2>
              <p>ProfeIA escribe la experiencia, te explica cada decisión y la muestra mientras se está construyendo.</p>
              <div className="suggestions">{SUGGESTIONS.map((suggestion) => <button key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-label">{message.role === "user" ? "Tú" : "ProfeIA"}</div>
                  <div className="message-card">
                    {message.html && <details className="code-disclosure"><summary>HTML generado <span>{message.html.length.toLocaleString()} caracteres</span></summary><pre><code>{message.html}</code></pre></details>}
                    <Markdown>{message.content}</Markdown>
                  </div>
                </article>
              ))}
              {isLoading && <article className="message model"><div className="message-label">ProfeIA</div><div className="message-card streaming-card">{streamingHtml && <details className="code-disclosure"><summary>Generando HTML…</summary><pre><code>{streamingHtml}</code></pre></details>}{streamingSummary ? <Markdown>{streamingSummary}</Markdown> : <div className="typing"><i /><i /><i /></div>}</div></article>}
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
          <div><span className={isPreviewBuilding ? "live-dot pulsing" : "live-dot"} /><strong>{isPreviewBuilding ? "Construyendo" : "Experiencia lista"}</strong></div>
          <div className="toolbar-actions">
            <button onClick={() => setIframeKey((key) => key + 1)} title="Recargar preview" aria-label="Recargar preview"><Icon name="reload" /></button>
            <button onClick={downloadHtml} disabled={!lastCompletedHtml} title="Descargar HTML" aria-label="Descargar HTML"><Icon name="download" /></button>
            <button onClick={() => setPreviewMode("fullscreen")} title="Ver por completo" aria-label="Ver por completo"><Icon name="expand" /></button>
            <button onClick={() => setPreviewMode("closed")} className="close-preview" aria-label="Cerrar preview">✕</button>
          </div>
        </div>
        <div className={`preview-stage ${isPreviewBuilding ? "is-building" : ""}`}>
          {previewHtml ? (
            <iframe key={iframeKey} title="Experiencia WebXR generada" srcDoc={previewHtml} onLoad={handlePreviewLoaded} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope" />
          ) : (
            <div className="preview-placeholder" aria-hidden="true"><img src="/university-logo.png" alt="Logo de la universidad" /></div>
          )}
          {isPreviewBuilding && <div className="build-overlay" role="status" aria-live="polite">
            <div className="liquid-lens"><span /><span /><span /></div>
            {streamingHtml && <pre ref={ghostCodeRef} className="ghost-code" aria-hidden="true"><code>{streamingHtml}</code></pre>}
            <div className="build-status"><div className="build-spinner" /><strong>Building... stand by</strong><small>Assembling your WebXR experience</small></div>
          </div>}
        </div>
        {previewMode === "fullscreen" && <button className="floating-back" onClick={() => setPreviewMode("split")}><Icon name="back" /> Volver al chat</button>}
      </aside>}
    </main>
  );
}


