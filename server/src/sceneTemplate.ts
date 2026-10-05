import { stripPreviewMonitor } from "./previewMonitor.js";

const SCENE_OPEN = "<webxr-scene>";
const SCENE_CLOSE = "</webxr-scene>";
const SPEC_ID = "profeia-scene-spec";
const MAX_OBJECTS = 100;

type Vec3 = [number, number, number];
type Shape = "box" | "sphere" | "cylinder" | "cone" | "plane" | "torus" | "text" | "image" | "model";
type Action = "info" | "toggle-color" | "toggle-visibility" | "spin";

interface SceneObject {
  id: string;
  shape: Shape;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  color?: string;
  colorAlt?: string;
  size?: Vec3;
  radius?: number;
  text?: string;
  url?: string;
  action?: Action;
  target?: string;
  info?: string;
  spinSpeed?: number;
}

interface SceneSpec {
  version: 1;
  title: string;
  instructions: string;
  sky?: string;
  floor?: string;
  camera?: Vec3;
  objects: SceneObject[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("La escena debe ser un objeto JSON.");
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label} inválido.`);
  return value.trim();
}

function optionalString(value: unknown, label: string, max = 500): string | undefined {
  return value === undefined ? undefined : string(value, label, max);
}

function vector(value: unknown, label: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 10000)) {
    throw new Error(`${label} debe tener tres números finitos.`);
  }
  return value as Vec3;
}

function optionalVector(value: unknown, label: string): Vec3 | undefined {
  return value === undefined ? undefined : vector(value, label);
}

function number(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000) throw new Error(`${label} inválido.`);
  return value;
}

function color(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const result = string(value, label, 7);
  if (!/^#[0-9a-fA-F]{6}$/.test(result)) throw new Error(`${label} debe ser hexadecimal (#RRGGBB).`);
  return result;
}

function url(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const result = string(value, label, 2048);
  try {
    if (new URL(result).protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${label} debe ser una URL HTTPS absoluta.`);
  }
  return result;
}

function parseSpec(value: unknown): SceneSpec {
  const raw = record(value);
  if (raw.version !== 1) throw new Error("Versión de escena no admitida.");
  if (!Array.isArray(raw.objects) || raw.objects.length === 0 || raw.objects.length > MAX_OBJECTS) {
    throw new Error(`La escena requiere entre 1 y ${MAX_OBJECTS} objetos.`);
  }
  const ids = new Set<string>();
  const objects = raw.objects.map((value, index): SceneObject => {
    const item = record(value);
    const id = string(item.id, `objects[${index}].id`, 64);
    if (!/^[a-zA-Z][\w-]*$/.test(id) || ids.has(id)) throw new Error(`ID inválido o repetido: ${id}`);
    ids.add(id);
    const shape = item.shape;
    if (!["box", "sphere", "cylinder", "cone", "plane", "torus", "text", "image", "model"].includes(String(shape))) {
      throw new Error(`Forma no admitida: ${String(shape)}`);
    }
    const action = item.action;
    if (action !== undefined && !["info", "toggle-color", "toggle-visibility", "spin"].includes(String(action))) {
      throw new Error(`Acción no admitida: ${String(action)}`);
    }
    const object: SceneObject = {
      id,
      shape: shape as Shape,
      position: vector(item.position, `${id}.position`),
      rotation: optionalVector(item.rotation, `${id}.rotation`),
      scale: optionalVector(item.scale, `${id}.scale`),
      size: optionalVector(item.size, `${id}.size`),
      radius: number(item.radius, `${id}.radius`),
      color: color(item.color, `${id}.color`),
      colorAlt: color(item.colorAlt, `${id}.colorAlt`),
      text: optionalString(item.text, `${id}.text`, 2000),
      url: url(item.url, `${id}.url`),
      action: action as Action | undefined,
      target: optionalString(item.target, `${id}.target`, 64),
      info: optionalString(item.info, `${id}.info`, 1000),
      spinSpeed: number(item.spinSpeed, `${id}.spinSpeed`),
    };
    if ((object.shape === "image" || object.shape === "model") && !object.url) throw new Error(`${id} necesita una URL.`);
    if (object.shape === "text" && !object.text) throw new Error(`${id} necesita texto.`);
    if (object.action === "info" && !object.info) throw new Error(`${id} necesita información.`);
    if (object.action === "toggle-color" && !object.colorAlt) throw new Error(`${id} necesita colorAlt.`);
    return object;
  });
  for (const object of objects) {
    if (object.target && !ids.has(object.target)) throw new Error(`El destino ${object.target} no existe.`);
    if (object.action === "toggle-visibility" && (!object.target || object.target === object.id)) throw new Error(`${object.id} necesita un target distinto de sí mismo.`);
  }
  return {
    version: 1,
    title: string(raw.title, "title", 120),
    instructions: string(raw.instructions, "instructions", 600),
    sky: color(raw.sky, "sky"),
    floor: color(raw.floor, "floor"),
    camera: optionalVector(raw.camera, "camera"),
    objects,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function vec(value: Vec3): string { return value.join(" "); }
function attr(name: string, value: string | number | undefined): string {
  return value === undefined ? "" : ` ${name}="${escapeHtml(String(value))}"`;
}

function renderObject(object: SceneObject): string {
  const common = `${attr("id", object.id)}${attr("position", vec(object.position))}${attr("rotation", object.rotation && vec(object.rotation))}${attr("scale", object.scale && vec(object.scale))}${attr("color", object.color)}${attr("class", object.action ? "interactive" : undefined)}`;
  const size = object.size ?? [1, 1, 1];
  const radius = object.radius ?? 0.5;
  switch (object.shape) {
    case "box": return `<a-box${common}${attr("width", size[0])}${attr("height", size[1])}${attr("depth", size[2])}></a-box>`;
    case "sphere": return `<a-sphere${common}${attr("radius", radius)}></a-sphere>`;
    case "cylinder": return `<a-cylinder${common}${attr("radius", radius)}${attr("height", size[1])}></a-cylinder>`;
    case "cone": return `<a-cone${common}${attr("radius-bottom", radius)}${attr("radius-top", 0)}${attr("height", size[1])}></a-cone>`;
    case "plane": return `<a-plane${common}${attr("width", size[0])}${attr("height", size[1])}></a-plane>`;
    case "torus": return `<a-torus${common}${attr("radius", radius)}></a-torus>`;
    case "text": return `<a-text${common}${attr("value", object.text)}${attr("align", "center")}${attr("width", size[0] * 4)}></a-text>`;
    case "image": return `<a-image${common}${attr("src", object.url)}${attr("width", size[0])}${attr("height", size[1])}></a-image>`;
    case "model": return `<a-entity${common}${attr("gltf-model", object.url)}></a-entity>`;
  }
}

export function renderScene(value: unknown): string {
  const spec = parseSpec(value);
  const specJson = JSON.stringify(spec).replace(/</g, "\\u003c");
  const camera = spec.camera ?? [0, 1.6, 0];
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(spec.title)}</title>
<script src="https://aframe.io/releases/1.8.0/aframe.min.js"></script>
<style>html,body{margin:0;width:100%;height:100%;font-family:system-ui,sans-serif;background:#101827;color:white}a-scene{width:100%;height:100%}.hud{position:fixed;z-index:10;top:16px;left:16px;max-width:min(360px,calc(100vw - 32px));padding:16px 18px;border:1px solid #ffffff55;border-radius:16px;background:#071222cc;backdrop-filter:blur(12px);box-shadow:0 8px 28px #0006}.hud h1{font-size:1.1rem;margin:0 0 8px}.hud p{font-size:.9rem;line-height:1.45;margin:0}.hint{opacity:.8;margin-top:10px!important}.message{position:fixed;z-index:11;bottom:24px;left:50%;transform:translateX(-50%);max-width:min(560px,calc(100vw - 32px));padding:12px 16px;border-radius:12px;background:#071222ec;display:none;text-align:center}.message.visible{display:block}.fallback{position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;background:#101827;z-index:20}.fallback[hidden]{display:none}@media(max-width:600px){.hud{top:8px;left:8px;padding:10px 12px;max-width:calc(100vw - 16px)}.hud h1{font-size:.95rem}.hud p{font-size:.8rem}}</style></head>
<body><div class="hud"><h1>${escapeHtml(spec.title)}</h1><p>${escapeHtml(spec.instructions)}</p><p class="hint">Explora con el ratón o el tacto. Usa el botón VR de la escena si tienes un dispositivo compatible.</p></div><div id="message" class="message" role="status" aria-live="polite"></div><div id="fallback" class="fallback" hidden>No se pudo iniciar el motor 3D. Comprueba la conexión y recarga la página.</div>
<a-scene background="color: ${spec.sky ?? "#101827"}" renderer="antialias: true" vr-mode-ui="enabled: true" embedded>
<a-entity id="rig" position="${vec(camera)}"><a-camera position="0 0 0" look-controls wasd-controls><a-cursor raycaster="objects: .interactive" fuse="false" color="#FFFFFF"></a-cursor></a-camera><a-entity laser-controls="hand: left" raycaster="objects: .interactive"></a-entity><a-entity laser-controls="hand: right" raycaster="objects: .interactive"></a-entity></a-entity>
<a-plane position="0 -0.02 0" rotation="-90 0 0" width="200" height="200" color="${spec.floor ?? "#253748"}"></a-plane>
<a-entity light="type: ambient; intensity: 0.75"></a-entity><a-entity light="type: directional; intensity: 0.8" position="-1 4 2"></a-entity>
${spec.objects.map(renderObject).join("\n")}</a-scene>
<script type="application/json" id="${SPEC_ID}">${specJson}</script>
<script>(()=>{const spec=JSON.parse(document.getElementById("${SPEC_ID}").textContent);const message=document.getElementById("message");let timer;for(const item of spec.objects){if(!item.action)continue;const el=document.getElementById(item.id);el.addEventListener("click",()=>{const target=document.getElementById(item.target||item.id);if(item.action==="info"){message.textContent=item.info;message.classList.add("visible");clearTimeout(timer);timer=setTimeout(()=>message.classList.remove("visible"),6000)}else if(item.action==="toggle-color"){if(!target.dataset.originalColor)target.dataset.originalColor=target.getAttribute("color")||"#FFFFFF";target.setAttribute("color",target.getAttribute("color")===item.colorAlt?target.dataset.originalColor:item.colorAlt)}else if(item.action==="toggle-visibility"){target.setAttribute("visible",!target.getAttribute("visible"))}else if(item.action==="spin"){const active=target.dataset.spinning!=="true";target.dataset.spinning=String(active);if(active)target.setAttribute("animation__spin",{property:"rotation",to:"0 360 0",dur:Math.max(500,10000/(item.spinSpeed||1)),loop:true,easing:"linear"});else target.removeAttribute("animation__spin")}})}addEventListener("load",()=>{if(!window.AFRAME)document.getElementById("fallback").hidden=false})})();</script>
</body></html>`;
}

export function extractSceneSpec(html: string): string | undefined {
  const clean = stripPreviewMonitor(html);
  const match = /<script\s+type=["']application\/json["']\s+id=["']profeia-scene-spec["']\s*>([\s\S]*?)<\/script>/i.exec(clean);
  if (!match) return undefined;
  try { return JSON.stringify(parseSpec(JSON.parse(match[1]))); }
  catch { return undefined; }
}

export function compileSceneResponse(response: string): string {
  const start = response.indexOf(SCENE_OPEN);
  if (start === -1) return response;
  const end = response.indexOf(SCENE_CLOSE, start + SCENE_OPEN.length);
  if (end === -1) throw new Error("La descripción de la escena está incompleta.");
  const spec = JSON.parse(response.slice(start + SCENE_OPEN.length, end));
  const html = renderScene(spec);
  return `${response.slice(0, start)}<webxr-html>\n${html}\n</webxr-html>${response.slice(end + SCENE_CLOSE.length)}`;
}
