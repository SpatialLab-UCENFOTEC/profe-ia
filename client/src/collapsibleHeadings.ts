import type { Element, Root, RootContent } from "hast";

// Group parsed headings, so heading syntax inside code stays untouched.
export function rehypeCollapsibleHeadings() {
  return (tree: Root) => {
    const output: RootContent[] = [];
    const stack: { level: number; content: Element }[] = [];
    for (const node of tree.children) {
      const level = node.type === "element" && /^h[1-6]$/.test(node.tagName)
        ? Number(node.tagName[1]) : 0;
      if (level && node.type === "element") {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const content: Element = {
          type: "element", tagName: "div",
          properties: { className: ["markdown-section-content"] }, children: [],
        };
        const section: Element = {
          type: "element", tagName: "details",
          properties: { className: ["markdown-section"] },
          children: [
            { type: "element", tagName: "summary", properties: {}, children: [node] },
            content,
          ],
        };
        const parent = stack[stack.length - 1];
        if (parent) parent.content.children.push(section);
        else output.push(section);
        stack.push({ level, content });
      } else {
        const parent = stack[stack.length - 1];
        if (parent) parent.content.children.push(node as Element["children"][number]);
        else output.push(node);
      }
    }
    tree.children = output;
  };
}