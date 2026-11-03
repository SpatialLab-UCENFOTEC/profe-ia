import { useEffect, useRef, useState } from "react";
import { WebXrStreamParser, isCompleteHtmlDocument } from "./streamParser";
import { classifyPreviewDiagnostic, errorsPrompt, type ClassifiedDiagnostic, type PreviewDiagnostic } from "./previewDiagnostics";
import { MAX_CONTEXT_MESSAGES, MAX_REPAIR_ATTEMPTS, PREVIEW_STARTUP_TIMEOUT_MS } from "./constants";
import type { DevScenario } from "./dev/devScenarios";
import { diagnosticLines } from "./codeTrace";
import type { GhostDiff, Message, PreviewMode, PreviewStatus, StreamEvent } from "./types";
import { useAuth } from "./hooks/useAuth";
import { AccessScreen } from "./components/AccessScreen";
import { DevAuditPanel } from "./components/DevAuditPanel";
import { ChatPane } from "./components/chat/ChatPane";
import { PreviewPanel } from "./components/preview/PreviewPanel";

export default function App() {
  const { authState, password, setPassword, authError, isAuthenticating, login, lock } = useAuth();
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
  const [ghostDiff, setGhostDiff] = useState<GhostDiff | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    let patching = false;

    const commitCompletedHtml = (html: string) => {
      if (committedHtml || !isCompleteHtmlDocument(html)) return;
      committedHtml = html.trim();
      const nextRunId = crypto.randomUUID();
      setGhostDiff(patching ? { id: nextRunId, before: currentCandidateRef.current || lastCompletedHtml, after: committedHtml } : null);
      setStreamingHtml(null);
      currentCandidateRef.current = committedHtml;
      diagnosticSignaturesRef.current.clear();
      fatalDiagnosticsRef.current = [];
      setPreviewDiagnostics([]);
      setPreviewStatus("checking");
      if (!isRepair) {
        repairAttemptRef.current = 0;
        correctionResponsesRef.current = [];
      }
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
      // Un parche llega ya aplicado como documento completo: no se transmite como código nuevo.
      if (parsed.hasHtml && !patching) {
        if (!committedHtml) setStreamingHtml(parsed.html);
        setPreviewMode((mode) => mode === "closed" ? "split" : mode);
        if (!buildingStarted) {
          buildingStarted = true;
          if (!isRepair) setPreviewStatus("generating");
          setIsPreviewBuilding(true);
        }
      }
      if (parsed.hasResponse) setStreamingSummary(parsed.response);
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "status") {
        patching = event.phase === "patching";
        if (patching) {
          setPreviewMode((mode) => mode === "closed" ? "split" : mode);
          if (!isRepair) setPreviewStatus("patching");
          setIsPreviewBuilding(true);
        }
      }
      if (event.type === "delta") updateParsedContent(event.text);
      if (event.type === "final") {
        const finalParser = new WebXrStreamParser();
        finalParser.push(event.text);
        const finalSnapshot = finalParser.snapshot();
        try {
          finalizedResult = finalParser.finish();
        } catch (parseError) {
          const hasUsableHtml = finalSnapshot.htmlComplete && isCompleteHtmlDocument(finalSnapshot.html);
          const isMissingResponse = !finalSnapshot.responseComplete || !finalSnapshot.response.trim();
          if (!hasUsableHtml || !isMissingResponse) throw parseError;

          const completedHtml = finalSnapshot.html.trim();
          finalizedResult = { html: completedHtml, response: "" };
          commitCompletedHtml(completedHtml);
          handleDiagnosticRef.current({ type: "missing-response", details: {} });
          return;
        }
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
      if (!finalMessageStored && result.response) {
        setMessages([...nextMessages, { id: crypto.randomUUID(), role: "model", content: result.response, html: result.html }]);
      }
    } catch (streamError) {
      if (!committedHtml) {
        awaitingFinalLoadRef.current = false;
        setIsPreviewBuilding(false);
        setPreviewStatus(status => status === "patching" || status === "generating" ? (lastCompletedHtml ? "ready" : "idle") : status);
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
    setGhostDiff(null);
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
        if (response.status === 401) lock(data.error || "Tu sesión venció. Ingresa la contraseña nuevamente.");
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
    setGhostDiff(null);
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

  const loadDevScenario = (scenario: DevScenario) => {
    if (!import.meta.env.DEV || isLoadingRef.current) return;
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    if (repairTimerRef.current) clearTimeout(repairTimerRef.current);
    awaitingFinalLoadRef.current = false;
    repairAttemptRef.current = scenario.status === "repair-failed" ? MAX_REPAIR_ATTEMPTS : 0;
    diagnosticSignaturesRef.current.clear();
    fatalDiagnosticsRef.current = [];
    correctionResponsesRef.current = scenario.corrections ?? [];
    pendingMessageIdRef.current = undefined;
    originalMessageIdRef.current = undefined;

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: scenario.question };
    const scenarioMessages = [userMessage];
    if (scenario.response) {
      scenarioMessages.push({
        id: crypto.randomUUID(),
        role: "model",
        content: scenario.response,
        html: scenario.status === "generating" ? undefined : scenario.html,
        corrections: scenario.corrections,
      });
    }
    setMessages(scenarioMessages);
    setInput("");
    setError(scenario.error ?? null);
    setStreamingSummary(scenario.status === "generating" ? scenario.response ?? "" : "");
    setStreamingHtml(scenario.status === "generating" ? scenario.html ?? null : null);
    const completedHtml = scenario.status === "generating" ? "" : scenario.html ?? "";
    setCurrentHtml(completedHtml);
    setLastCompletedHtml(scenario.status === "ready" ? completedHtml : "");
    currentCandidateRef.current = completedHtml;
    setPreviewStatus(scenario.status);
    setIsPreviewBuilding(["generating", "patching", "checking", "repairing", "repair-failed"].includes(scenario.status));
    setPreviewMode(scenario.html ? "split" : "closed");
    setPreviewRunId(crypto.randomUUID());
    setIframeKey(key => key + 1);
    setGhostDiff(scenario.previousHtml ? { id: crypto.randomUUID(), before: scenario.previousHtml, after: completedHtml } : null);

    const diagnostic = scenario.diagnostic ? classifyPreviewDiagnostic(scenario.diagnostic) : undefined;
    setPreviewDiagnostics(diagnostic ? [diagnostic] : []);
    if (diagnostic) fatalDiagnosticsRef.current = [diagnostic];
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
    setGhostDiff(null);
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
      : previewStatus === "patching"
        ? "Modificando experiencia"
      : previewStatus === "checking"
        ? "Comprobando experiencia"
      : previewStatus === "repair-failed"
        ? "Revisión manual necesaria"
        : isPreviewBuilding ? "Construyendo" : "Experiencia lista";

  if (authState === "checking") {
    return <main className="access-shell"><div className="access-loader" role="status" aria-label="Verificando acceso" /></main>;
  }

  if (authState === "locked") {
    return <AccessScreen password={password} error={authError} isSubmitting={isAuthenticating} onPasswordChange={setPassword} onSubmit={login} />;
  }

  return (
    <main className="app-shell">
      <div className="orb orb-one" /><div className="orb orb-two" />
      {import.meta.env.DEV && <DevAuditPanel disabled={isLoading} onLoad={loadDevScenario} />}
      <ChatPane
        messages={visibleMessages}
        isLoading={isLoading}
        isPreviewVisible={isPreviewVisible}
        showOpenPreview={Boolean(lastCompletedHtml) && previewMode === "closed"}
        streamingHtml={streamingHtml}
        streamingSummary={streamingSummary}
        input={input}
        error={error}
        textareaRef={textareaRef}
        onOpenPreview={() => setPreviewMode("split")}
        onInputChange={setInput}
        onSend={(content) => void sendMessage(content)}
        onDismissError={() => setError(null)}
      />
      {isPreviewVisible && <PreviewPanel
        previewMode={previewMode}
        previewStatus={previewStatus}
        statusLabel={previewStatusLabel}
        isBuilding={isPreviewBuilding}
        isStreamingCode={streamingHtml !== null}
        ghostCode={streamingHtml ?? currentHtml}
        ghostDiff={ghostDiff}
        errorLines={diagnosticLines(previewDiagnostics)}
        html={instrumentedPreviewHtml}
        iframeKey={iframeKey}
        iframeRef={iframeRef}
        canDownload={Boolean(lastCompletedHtml)}
        onLoad={handlePreviewLoaded}
        onReload={reloadPreview}
        onDownload={downloadHtml}
        onModeChange={setPreviewMode}
      />}
    </main>
  );
}
