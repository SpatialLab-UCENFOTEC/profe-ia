import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeCollapsibleHeadings } from "../collapsibleHeadings";

export function Markdown({ children, collapsible = false }: { children: string; collapsible?: boolean }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={collapsible ? [rehypeCollapsibleHeadings] : []}>{children}</ReactMarkdown></div>;
}
