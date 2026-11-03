import type { Message } from "../../types";
import { TechnicalDetailsIcon } from "../Icon";
import { Markdown } from "../Markdown";
import { CodeBlock } from "./CodeBlock";

export function MessageItem({ message }: { message: Message }) {
  return (
    <article className={`message ${message.role}`}>
      <div className="message-label">{message.role === "user" ? "Tú" : "ProfeIA"}</div>
      <div className="message-card">
        {message.html && <CodeBlock code={message.html} />}
        <Markdown collapsible={message.role === "model"}>{message.content}</Markdown>
        {message.corrections && message.corrections.length > 0 && <details className="corrections-disclosure">
          <summary><TechnicalDetailsIcon /><span>Se corrigió automáticamente</span><small>{message.corrections.length}</small></summary>
          <ol className="corrections-list">{message.corrections.map((correction, index) => <li key={`${index}-${correction}`}><strong>Corrección {index + 1}</strong><Markdown>{correction}</Markdown></li>)}</ol>
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
        {streamingHtml && <CodeBlock code={streamingHtml} streaming />}
        {streamingSummary ? <Markdown collapsible>{streamingSummary}</Markdown> : <div className="typing"><i /><i /><i /></div>}
      </div>
    </article>
  );
}
