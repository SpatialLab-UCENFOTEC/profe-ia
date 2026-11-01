import type { Message } from "../../types";
import { TechnicalDetailsIcon } from "../Icon";
import { Markdown } from "../Markdown";

export function MessageItem({ message }: { message: Message }) {
  return (
    <article className={`message ${message.role}`}>
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
  );
}

export function StreamingMessage({ streamingHtml, streamingSummary }: { streamingHtml: string | null; streamingSummary: string }) {
  return (
    <article className="message model">
      <div className="message-label">ProfeIA</div>
      <div className="message-card streaming-card">
        {streamingHtml && <details className="code-disclosure"><summary>Generando HTML…</summary><pre><code>{streamingHtml}</code></pre></details>}
        {streamingSummary ? <Markdown collapsible>{streamingSummary}</Markdown> : <div className="typing"><i /><i /><i /></div>}
      </div>
    </article>
  );
}
