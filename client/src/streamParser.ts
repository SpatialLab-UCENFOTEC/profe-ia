const HTML_OPEN = "<webxr-html>";
const HTML_CLOSE = "</webxr-html>";
const RESPONSE_OPEN = "<assistant-response>";
const RESPONSE_CLOSE = "</assistant-response>";

export interface ParsedStream {
  hasHtml: boolean;
  htmlComplete: boolean;
  html: string;
  hasResponse: boolean;
  responseComplete: boolean;
  response: string;
}

export interface CompletedResponse {
  html?: string;
  response: string;
}

function contentBetween(buffer: string, open: string, close: string) {
  const start = buffer.indexOf(open);
  if (start === -1) return { found: false, content: "", closed: false };
  const contentStart = start + open.length;
  const end = buffer.indexOf(close, contentStart);
  return {
    found: true,
    content: buffer.slice(contentStart, end === -1 ? undefined : end),
    closed: end !== -1,
  };
}

export function isCompleteHtmlDocument(html: string) {
  return (
    /^\s*<!doctype\s+html[^>]*>/i.test(html) &&
    /<html(?:\s|>)/i.test(html) &&
    /<head(?:\s|>)/i.test(html) &&
    /<\/head\s*>/i.test(html) &&
    /<body(?:\s|>)/i.test(html) &&
    /<\/body\s*>/i.test(html) &&
    /<\/html\s*>\s*$/i.test(html)
  );
}

export class WebXrStreamParser {
  private buffer = "";

  push(chunk: string): ParsedStream {
    this.buffer += chunk;
    return this.snapshot();
  }

  snapshot(): ParsedStream {
    const html = contentBetween(this.buffer, HTML_OPEN, HTML_CLOSE);
    const response = contentBetween(this.buffer, RESPONSE_OPEN, RESPONSE_CLOSE);
    return {
      hasHtml: html.found,
      htmlComplete: html.closed,
      html: html.content.trimStart(),
      hasResponse: response.found,
      responseComplete: response.closed,
      response: response.content.trimStart(),
    };
  }

  finish(): CompletedResponse {
    const html = contentBetween(this.buffer, HTML_OPEN, HTML_CLOSE);
    const response = contentBetween(this.buffer, RESPONSE_OPEN, RESPONSE_CLOSE);

    if (!response.found || !response.closed || !response.content.trim()) {
      throw new Error("La respuesta no contiene un resumen completo.");
    }

    if (html.found) {
      if (!html.closed || this.buffer.indexOf(HTML_OPEN) > this.buffer.indexOf(RESPONSE_OPEN)) {
        throw new Error("El bloque HTML está incompleto o fuera de orden.");
      }
      const completedHtml = html.content.trim();
      if (!isCompleteHtmlDocument(completedHtml)) {
        throw new Error("Gemini no devolvió un documento HTML completo y válido.");
      }
      return { html: completedHtml, response: response.content.trim() };
    }

    return { response: response.content.trim() };
  }
}
