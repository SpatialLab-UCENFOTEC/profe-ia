import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripPreviewMonitor } from "../previewMonitor.js";
import { type BaseDoc, validateDoc } from "./schema.js";

export const BASE_DOC_ID = "profeia-base-doc";
export const AFRAME_URL = "https://aframe.io/releases/1.8.0/aframe.min.js";

// Mismo camino relativo desde src/base (tsx) y desde dist/base (build).
const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime");
const RUNTIME_JS = readFileSync(join(RUNTIME_DIR, "profeia-base.js"), "utf8");
const RUNTIME_CSS = readFileSync(join(RUNTIME_DIR, "profeia-base.css"), "utf8");

const ZONES = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function embedJson(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// La base es siempre el mismo documento HTML; solo cambia el JSON embebido. El runtime lo lee al cargar
// y después recibe documentos nuevos por postMessage sin recargar.
export function renderBaseHtml(doc: BaseDoc) {
  const zones = ZONES.map(zone => `<div class="pb-zone" data-zone="${zone}"></div>`).join("");
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title || "Experiencia WebXR")}</title>
<script src="${AFRAME_URL}"></script>
<style id="profeia-base-style">
${RUNTIME_CSS}
</style>
</head>
<body>
<a-scene cursor="rayOrigin: mouse" raycaster="objects: .pb-interactive" renderer="colorManagement: true; antialias: true" vr-mode-ui="enabled: true" loading-screen="enabled: false">
  <a-entity id="pb-lights"></a-entity>
  <a-entity id="pb-floor" geometry="primitive: plane; width: 200; height: 200" rotation="-90 0 0" material="color: #253748; roughness: 1"></a-entity>
  <a-entity id="pb-rig" position="0 0 3">
    <a-entity id="pb-camera" camera position="0 1.6 0" look-controls wasd-controls>
      <a-entity id="pb-xr-ui" position="-0.55 0.35 -1.3"></a-entity>
    </a-entity>
    <a-entity laser-controls="hand: left" raycaster="objects: .pb-interactive; far: 30"></a-entity>
    <a-entity laser-controls="hand: right" raycaster="objects: .pb-interactive; far: 30"></a-entity>
  </a-entity>
  <a-entity id="pb-content"></a-entity>
</a-scene>
<div id="pb-ui" class="pb-ui">${zones}</div>
<div id="pb-message" class="pb-message" role="status" aria-live="polite"></div>
<div id="pb-fallback" class="pb-fallback" hidden>No se pudo cargar el motor 3D. Revisa la conexión y vuelve a intentar.</div>
<script type="application/json" id="${BASE_DOC_ID}">${embedJson(doc)}</script>
<script>
${RUNTIME_JS}
</script>
</body>
</html>`;
}

export function isBaseHtml(html: string) {
  return html.includes(`id="${BASE_DOC_ID}"`);
}

// Recupera el documento de una experiencia renderizada por la base (por ejemplo, el HTML actual que manda el cliente).
export function extractBaseDoc(html: string): BaseDoc | undefined {
  const clean = stripPreviewMonitor(html);
  const match = new RegExp(`<script type="application/json" id="${BASE_DOC_ID}">([\\s\\S]*?)</script>`).exec(clean);
  if (!match) return undefined;
  try {
    return validateDoc(JSON.parse(match[1]));
  } catch {
    return undefined;
  }
}
