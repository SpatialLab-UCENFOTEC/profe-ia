import { motion } from "motion/react";
import type { Message } from "../../types";
import { heavy, jumpy } from "../../motion";
import { TechnicalDetailsIcon } from "../Icon";
import { Markdown } from "../Markdown";
import { CodeBlock } from "./CodeBlock";

export function MessageItem({ message }: { message: Message }) {
  const fromX = message.role === "user" ? 36 : -36;
  return (
    <motion.article
      className={`message ${message.role}`}
      layout="position"
      initial={{ opacity: 0, x: fromX, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      transition={{ ...heavy, opacity: { duration: 0.18 } }}
    >
      <div className="message-label">{message.role === "user" ? "Tú" : "ProfeIA"}</div>
      <div className="message-card">
        {message.html && <CodeBlock code={message.html} />}
        <Markdown collapsible={message.role === "assistant"}>{message.content}</Markdown>
        {message.corrections && message.corrections.length > 0 && <details className="corrections-disclosure">
          <summary><TechnicalDetailsIcon /><span>Se corrigió automáticamente</span><small>{message.corrections.length}</small></summary>
          <ol className="corrections-list">{message.corrections.map((correction, index) => <li key={`${index}-${correction}`}><strong>Corrección {index + 1}</strong><Markdown>{correction}</Markdown></li>)}</ol>
        </details>}
      </div>
    </motion.article>
  );
}

export function StreamingMessage({ streamingHtml, streamingSummary }: { streamingHtml: string | null; streamingSummary: string }) {
  return (
    <motion.article
      className="message model"
      layout="position"
      initial={{ opacity: 0, scale: 0.6, y: 14 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
      transition={{ ...jumpy, opacity: { duration: 0.12 } }}
    >
      <div className="message-label">ProfeIA</div>
      <div className="message-card streaming-card">
        {streamingHtml && <CodeBlock code={streamingHtml} streaming />}
        {streamingSummary ? <Markdown collapsible>{streamingSummary}</Markdown> : <div className="typing"><i /><i /><i /></div>}
      </div>
    </motion.article>
  );
}
