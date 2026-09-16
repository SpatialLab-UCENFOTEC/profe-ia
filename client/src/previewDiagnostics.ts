export type PreviewDiagnosticType =
  | "runtime-error"
  | "unhandled-rejection"
  | "resource-error"
  | "startup-timeout"
  | "missing-response"
  | "experience-ready";

export interface PreviewDiagnostic {
  type: PreviewDiagnosticType;
  details: Record<string, unknown>;
}

export type DiagnosticSeverity = "fatal" | "warning" | "ignored" | "ready";

export interface ClassifiedDiagnostic extends PreviewDiagnostic {
  severity: DiagnosticSeverity;
  summary: string;
  signature: string;
}

const IGNORED_RUNTIME_PATTERNS = [
  /ResizeObserver loop/i,
  /AbortError/i,
  /The operation was aborted/i,
];

function stringDetail(details: Record<string, unknown>, key: string) {
  const value = details[key];
  return typeof value === "string" ? value : "";
}

export function classifyPreviewDiagnostic(diagnostic: PreviewDiagnostic): ClassifiedDiagnostic {
  const message = stringDetail(diagnostic.details, "message") || "Error sin mensaje";
  const tag = stringDetail(diagnostic.details, "tag").toUpperCase();
  const url = stringDetail(diagnostic.details, "url");
  const rel = stringDetail(diagnostic.details, "rel").toLowerCase();
  let severity: DiagnosticSeverity = "fatal";
  let summary = message;

  if (diagnostic.type === "experience-ready") {
    severity = "ready";
    summary = "La experiencia inició correctamente.";
  } else if (diagnostic.type === "startup-timeout") {
    summary = "La experiencia no informó que estuviera lista dentro del tiempo esperado.";
  } else if (diagnostic.type === "missing-response") {
    summary = "El código de la experiencia está completo, pero falta la respuesta visible para el usuario. Devuelve también un bloque <assistant-response> completo que explique qué se creó o cambió y cómo usarlo.";
  } else if (diagnostic.type === "resource-error") {
    const fatalResource = tag === "SCRIPT" || tag === "A-ASSET-ITEM" ||
      (tag === "LINK" && (rel === "stylesheet" || rel === "modulepreload"));
    severity = fatalResource ? "fatal" : "warning";
    summary = `No se pudo cargar ${tag || "un recurso"}${url ? `: ${url}` : "."}`;
  } else if (IGNORED_RUNTIME_PATTERNS.some(pattern => pattern.test(message))) {
    severity = "ignored";
  }

  const location = [stringDetail(diagnostic.details, "filename"), diagnostic.details.line]
    .filter(Boolean).join(":");
  const signature = [diagnostic.type, message, tag, url, location].join("|");
  return { ...diagnostic, severity, summary, signature };
}

export function errorsPrompt(diagnostics: ClassifiedDiagnostic[]) {
  const lines = diagnostics
    .filter(item => item.severity === "fatal")
    .map((item, index) => {
      const stack = stringDetail(item.details, "stack").slice(0, 1_500);
      return `${index + 1}. ${item.type}: ${item.summary}${stack ? `\n${stack}` : ""}`;
    });
  return `<ERRORS>\n${lines.join("\n\n").slice(0, 7_500)}\n</ERRORS>`;
}
