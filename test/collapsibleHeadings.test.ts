import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rehypeCollapsibleHeadings } from "../src/collapsibleHeadings";

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, {
  children: text, remarkPlugins: [remarkGfm], rehypePlugins: [rehypeCollapsibleHeadings],
}));
it("keeps introductions visible and sibling sections closed", () => {
  const html = render("Introducción\n\n# Uno\n\nContenido uno\n\n# Dos\n\nContenido dos");
  assert.ok(html.startsWith("<p>Introducción</p>"));
  assert.equal((html.match(/<details/g) ?? []).length, 2);
  assert.ok(html.indexOf("</details>") < html.indexOf("<h1>Dos</h1>"));
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});
it("nests subsections and closes parents at the next same-level heading", () => {
  const html = render("# Padre\n\n## Hijo\n\n### Nieto\n\nTexto\n\n# Siguiente\n\nFin");
  assert.equal((html.match(/<details/g) ?? []).length, 4);
  assert.match(html, /Texto<\/p>\s*<\/div><\/details><\/div><\/details><\/div><\/details>/);
  assert.match(html, /<summary><h3>Nieto<\/h3><\/summary>/);
});
it("preserves code, tables, lists and inline heading formatting", () => {
  const html = render("# **Título**\n\n~~~md\n# No es sección\n~~~\n\n- Elemento\n\n| A | B |\n|---|---|\n| 1 | 2 |");
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  assert.match(html, /<strong>Título<\/strong>/);
  assert.match(html, /<code class="language-md"># No es sección/);
  assert.match(html, /<li>Elemento<\/li>/);
  assert.match(html, /<table>/);
});
it("preserves plain responses and handles headings with no content yet", () => {
  assert.equal(render("Texto simple"), "<p>Texto simple</p>");
  assert.match(render("# Encabezado"), /<summary><h1>Encabezado<\/h1><\/summary>/);
});