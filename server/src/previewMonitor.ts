const MONITOR_ID = "profeia-preview-monitor";

export const PREVIEW_RUN_ID_PLACEHOLDER = "__PROFEIA_PREVIEW_RUN_ID__";

export const PREVIEW_MONITOR_SCRIPT = `<script id="${MONITOR_ID}">
(() => {
  const namespace = "profeia-preview";
  const runId = "${PREVIEW_RUN_ID_PLACEHOLDER}";
  const send = (type, details = {}) => parent.postMessage({ namespace, runId, type, details }, "*");
  const text = value => {
    try { return value instanceof Error ? value.message : String(value ?? "Error desconocido"); }
    catch { return "Error desconocido"; }
  };

  addEventListener("error", event => {
    const target = event.target;
    if (target && target !== window) {
      send("resource-error", {
        tag: target.tagName || "",
        url: target.currentSrc || target.src || target.href || "",
        resourceType: target.getAttribute?.("type") || "",
        rel: target.getAttribute?.("rel") || ""
      });
      return;
    }
    send("runtime-error", {
      message: event.message || "Error de JavaScript",
      filename: event.filename || "",
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: event.error?.stack || ""
    });
  }, true);

  addEventListener("unhandledrejection", event => send("unhandled-rejection", {
    message: text(event.reason),
    stack: event.reason?.stack || ""
  }));

  const announceReady = () => {
    const scene = document.querySelector("a-scene");
    if (!scene) {
      requestAnimationFrame(() => send("experience-ready", { engine: "generic" }));
      return;
    }
    if (scene.hasLoaded) send("experience-ready", { engine: "aframe" });
    else scene.addEventListener("loaded", () => send("experience-ready", { engine: "aframe" }), { once: true });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", announceReady, { once: true });
  else announceReady();
})();
</script>`;

export function ensurePreviewMonitor(html: string) {
  if (html.includes(PREVIEW_MONITOR_SCRIPT)) return html;
  const cleanHtml = stripPreviewMonitor(html);
  const head = /<head(?:\s[^>]*)?>/i.exec(cleanHtml);
  if (head?.index !== undefined) {
    const insertAt = head.index + head[0].length;
    return `${cleanHtml.slice(0, insertAt)}\n${PREVIEW_MONITOR_SCRIPT}${cleanHtml.slice(insertAt)}`;
  }
  return cleanHtml.replace(/<html(?:\s[^>]*)?>/i, match => `${match}\n<head>${PREVIEW_MONITOR_SCRIPT}</head>`);
}

export function stripPreviewMonitor(html: string) {
  return html.replace(new RegExp(`<script\\s+[^>]*id=["']${MONITOR_ID}["'][^>]*>[\\s\\S]*?<\\/script>\\s*`, "i"), "");
}

export function instrumentGeneratedResponse(response: string) {
  const open = "<webxr-html>";
  const close = "</webxr-html>";
  const start = response.indexOf(open);
  if (start === -1) return response;
  const contentStart = start + open.length;
  const end = response.indexOf(close, contentStart);
  if (end === -1) return response;
  const html = response.slice(contentStart, end);
  return `${response.slice(0, contentStart)}${ensurePreviewMonitor(html)}${response.slice(end)}`;
}
