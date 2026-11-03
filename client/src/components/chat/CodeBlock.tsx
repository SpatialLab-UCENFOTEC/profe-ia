import { useMemo, useState } from "react";
import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("xml", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("css", css);

const FILENAME = "experiencia-webxr.html";

export function CodeBlock({ code, streaming = false }: { code: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"), [lineCount]);
  // Highlighting runs only once opened and never while streaming, so long documents stay cheap.
  const highlighted = useMemo(
    () => (open && !streaming ? hljs.highlight(code, { language: "xml" }).value : null),
    [open, streaming, code],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <details className="code-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        {streaming ? <>Generando HTML<i className="code-pulse" /></> : "HTML generado"}
        <span>{lineCount.toLocaleString()} líneas{streaming ? "" : ` · ${(code.length / 1024).toFixed(1)} KB`}</span>
      </summary>
      <div className="code-body">
        <div className="code-toolbar">
          <code>{FILENAME}</code>
          {!streaming && <>
            <button type="button" onClick={copy}>{copied ? "Copiado" : "Copiar"}</button>
            <button type="button" onClick={download}>Descargar</button>
          </>}
        </div>
        <div className="code-scroll">
          <pre className="code-gutter" aria-hidden="true">{gutter}</pre>
          {highlighted === null
            ? <pre className="code-lines"><code>{code}</code></pre>
            : <pre className="code-lines"><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>}
        </div>
      </div>
    </details>
  );
}
