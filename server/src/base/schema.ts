// Documento que describe una experiencia sobre la base fija. El modelo lo modifica con operaciones (ops.ts)
// y el runtime del navegador (server/runtime/profeia-base.js) lo aplica en vivo.

export type Vec3 = [number, number, number];

export const ENTITY_SHAPES = [
  "box", "sphere", "cylinder", "cone", "plane", "circle", "ring", "torus", "torusKnot",
  "tetrahedron", "octahedron", "dodecahedron", "icosahedron", "text", "image", "model", "light", "group", "sound",
] as const;
export const UI_TYPES = ["panel", "text", "button", "slider", "toggle", "select", "image", "progress", "html"] as const;
export const UI_ZONES = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;
export const LIGHTING_PRESETS = ["studio", "day", "sunset", "night", "none"] as const;
export const ACTIONS = ["emit", "set", "toggle", "show", "hide", "message", "animate", "stop", "state"] as const;

export type EntityShape = typeof ENTITY_SHAPES[number];
export type UiType = typeof UI_TYPES[number];

export interface Action {
  do: typeof ACTIONS[number];
  [key: string]: unknown;
}

export type Handlers = Record<string, Action[]>;

export interface EntitySpec {
  shape: EntityShape;
  parent?: string;
  position?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  size?: Vec3;
  radius?: number;
  color?: string;
  opacity?: number;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  wireframe?: boolean;
  flatShading?: boolean;
  texture?: string;
  text?: string;
  align?: "left" | "center" | "right";
  wrapCount?: number;
  label?: string;
  labelColor?: string;
  url?: string;
  autoplay?: boolean;
  loop?: boolean;
  lightType?: "point" | "spot" | "directional" | "ambient" | "hemisphere";
  intensity?: number;
  distance?: number;
  visible?: boolean;
  interactive?: boolean;
  tags?: string[];
  components?: Record<string, unknown>;
  on?: Handlers;
}

export interface UiSpec {
  type: UiType;
  zone?: typeof UI_ZONES[number];
  parent?: string;
  order?: number;
  title?: string;
  text?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number | string;
  checked?: boolean;
  options?: Array<string | { value: string; label?: string }>;
  url?: string;
  html?: string;
  hidden?: boolean;
  style?: Record<string, string | number>;
  className?: string;
  xr?: boolean;
  on?: Handlers;
}

export interface ScriptSpec {
  code: string;
  order?: number;
}

export interface Environment {
  sky?: string;
  floor?: string | null;
  lighting?: typeof LIGHTING_PRESETS[number];
  fog?: { color?: string; near?: number; far?: number } | null;
  player?: Vec3;
  lookAt?: Vec3;
}

export interface BaseDoc {
  version: 2;
  title: string;
  instructions: string;
  environment: Environment;
  entities: Record<string, EntitySpec>;
  ui: Record<string, UiSpec>;
  scripts: Record<string, ScriptSpec>;
  styles: Record<string, string>;
}

export const LIMITS = {
  entities: 300,
  ui: 100,
  scripts: 30,
  scriptLength: 20_000,
  styles: 30,
  styleLength: 10_000,
  docLength: 150_000,
};

const ID_PATTERN = /^[a-zA-Z][\w-]{0,63}$/;
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const ENTITY_KEYS = new Set([
  "shape", "parent", "position", "rotation", "scale", "size", "radius", "color", "opacity", "metalness", "roughness",
  "emissive", "emissiveIntensity", "wireframe", "flatShading", "texture", "text", "align", "wrapCount", "label", "labelColor",
  "url", "autoplay", "loop", "lightType", "intensity", "distance", "visible", "interactive", "tags", "components", "on",
]);
const UI_KEYS = new Set([
  "type", "zone", "parent", "order", "title", "text", "label", "min", "max", "step", "value", "checked", "options",
  "url", "html", "hidden", "style", "className", "xr", "on",
]);
const ENVIRONMENT_KEYS = new Set(["sky", "floor", "lighting", "fog", "player", "lookAt"]);

export function emptyDoc(): BaseDoc {
  return {
    version: 2,
    title: "Escena vacía",
    instructions: "Describe en el chat la práctica que quieres construir.",
    environment: { sky: "#101827", floor: "#253748", lighting: "studio", player: [0, 0, 3] },
    entities: {},
    ui: {
      info: {
        type: "panel",
        zone: "top-left",
        title: "Escena vacía",
        text: "Describe en el chat la práctica que quieres construir y aparecerá aquí.",
      },
    },
    scripts: {},
    styles: {},
  };
}

export class DocError extends Error {}

function fail(message: string): never {
  throw new DocError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function checkId(id: string, label: string) {
  if (!ID_PATTERN.test(id)) fail(`${label} "${id}" no es un id válido (letra inicial, luego letras, números, _ o -; máximo 64).`);
}

function checkVector(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(item => typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > 10000)) {
    fail(`${label} debe ser [x, y, z] con números finitos.`);
  }
}

function checkNumber(value: unknown, label: string, min = -10000, max = 10000) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label} debe ser un número entre ${min} y ${max}.`);
}

function checkString(value: unknown, label: string, max = 4000) {
  if (typeof value !== "string" || value.length > max) fail(`${label} debe ser texto de hasta ${max} caracteres.`);
}

function checkColor(value: unknown, label: string) {
  if (typeof value !== "string" || !COLOR_PATTERN.test(value)) fail(`${label} debe ser un color hexadecimal (#RRGGBB).`);
}

function checkUrl(value: unknown, label: string) {
  checkString(value, label, 2048);
  let parsed: URL;
  try { parsed = new URL(value as string); }
  catch { fail(`${label} no es una URL válida.`); }
  if (parsed.protocol !== "https:") fail(`${label} debe usar https.`);
}

function checkBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") fail(`${label} debe ser true o false.`);
}

function checkHandlers(value: unknown, label: string) {
  if (!isRecord(value)) fail(`${label}.on debe ser un objeto { evento: [acciones] }.`);
  for (const [eventName, actions] of Object.entries(value)) {
    if (!/^[\w:.-]{1,80}$/.test(eventName)) fail(`${label}.on tiene un evento inválido: "${eventName}".`);
    if (!Array.isArray(actions)) fail(`${label}.on.${eventName} debe ser una lista de acciones.`);
    if (actions.length > 30) fail(`${label}.on.${eventName} tiene demasiadas acciones.`);
    actions.forEach((action, index) => {
      if (!isRecord(action) || !(ACTIONS as readonly string[]).includes(action.do as string)) {
        fail(`${label}.on.${eventName}[${index}] necesita "do" con uno de: ${ACTIONS.join(", ")}.`);
      }
      if ((action.do === "emit") && typeof action.event !== "string") fail(`${label}.on.${eventName}[${index}]: emit necesita "event".`);
      if (action.do === "set" && typeof action.prop !== "string") fail(`${label}.on.${eventName}[${index}]: set necesita "prop".`);
      if (action.do === "state" && typeof action.key !== "string") fail(`${label}.on.${eventName}[${index}]: state necesita "key".`);
      if (action.do === "message" && typeof action.text !== "string") fail(`${label}.on.${eventName}[${index}]: message necesita "text".`);
    });
  }
}

function checkUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, label: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} tiene la propiedad desconocida "${key}". Para componentes de A-Frame usa "components".`);
  }
}

function validateEntity(id: string, value: unknown) {
  const label = `entities.${id}`;
  if (!isRecord(value)) fail(`${label} debe ser un objeto.`);
  checkUnknownKeys(value, ENTITY_KEYS, label);
  if (!(ENTITY_SHAPES as readonly string[]).includes(value.shape as string)) fail(`${label}.shape debe ser uno de: ${ENTITY_SHAPES.join(", ")}.`);
  for (const key of ["position", "rotation", "scale", "size"] as const) if (value[key] !== undefined) checkVector(value[key], `${label}.${key}`);
  for (const key of ["radius", "distance"] as const) if (value[key] !== undefined) checkNumber(value[key], `${label}.${key}`, 0);
  for (const key of ["opacity", "metalness", "roughness"] as const) if (value[key] !== undefined) checkNumber(value[key], `${label}.${key}`, 0, 1);
  for (const key of ["emissiveIntensity", "intensity"] as const) if (value[key] !== undefined) checkNumber(value[key], `${label}.${key}`, 0, 100);
  if (value.wrapCount !== undefined) checkNumber(value.wrapCount, `${label}.wrapCount`, 1, 400);
  for (const key of ["color", "emissive", "labelColor"] as const) if (value[key] !== undefined) checkColor(value[key], `${label}.${key}`);
  for (const key of ["text", "label"] as const) if (value[key] !== undefined) checkString(value[key], `${label}.${key}`);
  for (const key of ["url", "texture"] as const) if (value[key] !== undefined) checkUrl(value[key], `${label}.${key}`);
  for (const key of ["wireframe", "flatShading", "visible", "interactive", "autoplay", "loop"] as const) if (value[key] !== undefined) checkBoolean(value[key], `${label}.${key}`);
  if (value.parent !== undefined) checkString(value.parent, `${label}.parent`, 64);
  if (value.align !== undefined && !["left", "center", "right"].includes(value.align as string)) fail(`${label}.align debe ser left, center o right.`);
  if (value.lightType !== undefined && !["point", "spot", "directional", "ambient", "hemisphere"].includes(value.lightType as string)) fail(`${label}.lightType inválido.`);
  if ((value.shape === "image" || value.shape === "model" || value.shape === "sound") && value.url === undefined) fail(`${label} (${value.shape}) necesita "url".`);
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some(tag => typeof tag !== "string" || !ID_PATTERN.test(tag)))) fail(`${label}.tags debe ser una lista de ids.`);
  if (value.components !== undefined) {
    if (!isRecord(value.components)) fail(`${label}.components debe ser un objeto { componente: valor }.`);
    for (const [name, component] of Object.entries(value.components)) {
      if (!/^[a-z][\w-]*(?:__[\w-]+)?$/.test(name)) fail(`${label}.components tiene un nombre inválido: "${name}".`);
      if (!["string", "number", "boolean"].includes(typeof component) && !isRecord(component)) fail(`${label}.components.${name} debe ser texto, número, booleano u objeto.`);
    }
  }
  if (value.on !== undefined) checkHandlers(value.on, label);
}

function validateUi(id: string, value: unknown) {
  const label = `ui.${id}`;
  if (!isRecord(value)) fail(`${label} debe ser un objeto.`);
  checkUnknownKeys(value, UI_KEYS, label);
  if (!(UI_TYPES as readonly string[]).includes(value.type as string)) fail(`${label}.type debe ser uno de: ${UI_TYPES.join(", ")}.`);
  if (value.zone !== undefined && !(UI_ZONES as readonly string[]).includes(value.zone as string)) fail(`${label}.zone debe ser una de: ${UI_ZONES.join(", ")}.`);
  if (value.parent !== undefined) checkString(value.parent, `${label}.parent`, 64);
  for (const key of ["order", "min", "max", "step"] as const) if (value[key] !== undefined) checkNumber(value[key], `${label}.${key}`, -1e9, 1e9);
  for (const key of ["title", "text", "label", "className"] as const) if (value[key] !== undefined) checkString(value[key], `${label}.${key}`);
  if (value.html !== undefined) checkString(value.html, `${label}.html`, 20_000);
  for (const key of ["checked", "hidden", "xr"] as const) if (value[key] !== undefined) checkBoolean(value[key], `${label}.${key}`);
  if (value.value !== undefined && typeof value.value !== "number" && typeof value.value !== "string") fail(`${label}.value debe ser número o texto.`);
  if (value.url !== undefined) checkUrl(value.url, `${label}.url`);
  if (value.type === "image" && value.url === undefined) fail(`${label} (image) necesita "url".`);
  if (value.type === "select" && !Array.isArray(value.options)) fail(`${label} (select) necesita "options".`);
  if (value.options !== undefined) {
    if (!Array.isArray(value.options) || value.options.length > 100) fail(`${label}.options debe ser una lista.`);
    for (const option of value.options) {
      if (typeof option === "string") continue;
      if (!isRecord(option) || typeof option.value !== "string") fail(`${label}.options acepta textos u objetos { value, label }.`);
    }
  }
  if (value.style !== undefined) {
    if (!isRecord(value.style)) fail(`${label}.style debe ser un objeto { propiedad: valor }.`);
    for (const [property, styleValue] of Object.entries(value.style)) {
      if (typeof styleValue !== "string" && typeof styleValue !== "number") fail(`${label}.style.${property} debe ser texto o número.`);
    }
  }
  if (value.on !== undefined) checkHandlers(value.on, label);
}

function validateEnvironment(value: unknown) {
  if (!isRecord(value)) fail("environment debe ser un objeto.");
  checkUnknownKeys(value, ENVIRONMENT_KEYS, "environment");
  if (value.sky !== undefined) checkColor(value.sky, "environment.sky");
  if (value.floor !== undefined && value.floor !== null) checkColor(value.floor, "environment.floor");
  if (value.lighting !== undefined && !(LIGHTING_PRESETS as readonly string[]).includes(value.lighting as string)) fail(`environment.lighting debe ser uno de: ${LIGHTING_PRESETS.join(", ")}.`);
  if (value.player !== undefined) checkVector(value.player, "environment.player");
  if (value.lookAt !== undefined) checkVector(value.lookAt, "environment.lookAt");
  if (value.fog !== undefined && value.fog !== null) {
    if (!isRecord(value.fog)) fail("environment.fog debe ser un objeto { color, near, far } o null.");
    if (value.fog.color !== undefined) checkColor(value.fog.color, "environment.fog.color");
    if (value.fog.near !== undefined) checkNumber(value.fog.near, "environment.fog.near", 0);
    if (value.fog.far !== undefined) checkNumber(value.fog.far, "environment.fog.far", 0);
  }
}

function checkParents(items: Record<string, { parent?: string }>, kind: string, allowed: (parentId: string) => boolean) {
  for (const [id, item] of Object.entries(items)) {
    if (item.parent === undefined) continue;
    if (!allowed(item.parent)) fail(`${kind}.${id}.parent apunta a "${item.parent}", que no existe o no puede contener elementos.`);
    const seen = new Set([id]);
    let cursor: string | undefined = item.parent;
    while (cursor !== undefined) {
      if (seen.has(cursor)) fail(`${kind}.${id} forma un ciclo de padres.`);
      seen.add(cursor);
      cursor = items[cursor]?.parent;
    }
  }
}

export function validateDoc(value: unknown): BaseDoc {
  if (!isRecord(value)) fail("El documento debe ser un objeto.");
  if (value.version !== 2) fail("El documento debe tener version 2.");
  checkString(value.title, "title", 200);
  checkString(value.instructions, "instructions", 2000);
  validateEnvironment(value.environment);
  for (const key of ["entities", "ui", "scripts", "styles"] as const) {
    if (!isRecord(value[key])) fail(`${key} debe ser un objeto { id: valor }.`);
  }
  const entities = value.entities as Record<string, unknown>;
  const ui = value.ui as Record<string, unknown>;
  const scripts = value.scripts as Record<string, unknown>;
  const styles = value.styles as Record<string, unknown>;
  if (Object.keys(entities).length > LIMITS.entities) fail(`Hay más de ${LIMITS.entities} entidades.`);
  if (Object.keys(ui).length > LIMITS.ui) fail(`Hay más de ${LIMITS.ui} elementos de interfaz.`);
  if (Object.keys(scripts).length > LIMITS.scripts) fail(`Hay más de ${LIMITS.scripts} scripts.`);
  if (Object.keys(styles).length > LIMITS.styles) fail(`Hay más de ${LIMITS.styles} estilos.`);

  for (const [id, entity] of Object.entries(entities)) {
    checkId(id, "La entidad");
    if (id in ui) fail(`El id "${id}" se usa en una entidad y en la interfaz; deben ser únicos.`);
    validateEntity(id, entity);
  }
  for (const [id, item] of Object.entries(ui)) {
    checkId(id, "El elemento de interfaz");
    validateUi(id, item);
  }
  for (const [id, script] of Object.entries(scripts)) {
    checkId(id, "El script");
    if (!isRecord(script) || typeof script.code !== "string") fail(`scripts.${id} debe ser { code: "..." }.`);
    if (script.code.length > LIMITS.scriptLength) fail(`scripts.${id} supera ${LIMITS.scriptLength} caracteres.`);
    if (script.order !== undefined) checkNumber(script.order, `scripts.${id}.order`);
    for (const key of Object.keys(script)) if (key !== "code" && key !== "order") fail(`scripts.${id} tiene la propiedad desconocida "${key}".`);
  }
  for (const [id, css] of Object.entries(styles)) {
    checkId(id, "El estilo");
    if (typeof css !== "string" || css.length > LIMITS.styleLength) fail(`styles.${id} debe ser CSS de hasta ${LIMITS.styleLength} caracteres.`);
    if (/<\/style/i.test(css)) fail(`styles.${id} no puede cerrar la etiqueta style.`);
  }

  const typedEntities = entities as Record<string, EntitySpec>;
  const typedUi = ui as Record<string, UiSpec>;
  checkParents(typedEntities, "entities", parentId => parentId in typedEntities);
  checkParents(typedUi, "ui", parentId => typedUi[parentId]?.type === "panel");

  const doc = value as unknown as BaseDoc;
  if (JSON.stringify(doc).length > LIMITS.docLength) fail(`El documento supera ${LIMITS.docLength} caracteres; simplifica la experiencia.`);
  return doc;
}
