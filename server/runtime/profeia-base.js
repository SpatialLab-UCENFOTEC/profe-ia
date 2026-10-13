/*! ProfeIA base runtime. Construye la experiencia desde un documento JSON y aplica cambios en vivo. */
(() => {
  "use strict";

  const RUNTIME_VERSION = 1;
  const BASE_NS = "profeia-base";
  const ZONES = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
  const LOCAL_EVENTS = ["click", "hover", "leave", "change"];
  // Cambios de entidad que se aplican sobre el mismo elemento, sin reconstruir la escena.
  const ENTITY_REBUILD_KEYS = ["shape", "parent"];
  const UI_REBUILD_KEYS = ["type"];

  const scene = document.querySelector("a-scene");
  const content = document.getElementById("pb-content");
  const lights = document.getElementById("pb-lights");
  const floor = document.getElementById("pb-floor");
  const rig = document.getElementById("pb-rig");
  const camera = document.getElementById("pb-camera");
  const xrRoot = document.getElementById("pb-xr-ui");
  const uiRoot = document.getElementById("pb-ui");
  const messageEl = document.getElementById("pb-message");
  const docEl = document.getElementById("profeia-base-doc");

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const entries = value => Object.entries(value || {});

  let current = { version: 2, title: "", instructions: "", environment: {}, entities: {}, ui: {}, scripts: {}, styles: {} };
  let state = {};
  let liveUi = {};
  const bus = new EventTarget();
  const declarativeHandlers = [];
  let scriptScopes = [];
  const scriptComponentNames = new Set();
  let scriptsLive = false;
  const tickers = new Set();
  const loadedScripts = new Map();
  let messageTimer;

  function report(error, origin) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack ? error.stack : "";
    const monitor = window.__profeiaPreview;
    if (monitor) monitor.send("runtime-error", { message: `${origin}: ${message}`, filename: origin, line: 0, column: 0, stack });
    console.error(`[ProfeIA] ${origin}:`, error);
  }

  // ---------- Bus de eventos ----------
  function emit(name, detail) {
    bus.dispatchEvent(new CustomEvent(String(name), { detail }));
  }

  function listen(name, fn, registry) {
    const handler = event => {
      try { fn(event.detail, event); }
      catch (error) { report(error, `evento ${name}`); }
    };
    bus.addEventListener(String(name), handler);
    const off = () => bus.removeEventListener(String(name), handler);
    if (registry) registry.push(off);
    return off;
  }

  // ---------- Estado y plantillas {{clave}} ----------
  function template(value) {
    if (typeof value !== "string") return value === undefined || value === null ? "" : String(value);
    return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
      const result = key.split(".").reduce((item, part) => item == null ? undefined : item[part], state);
      return result === undefined || result === null ? "" : String(result);
    });
  }

  function setState(key, value) {
    state[key] = value;
    emit(`state:${key}`, value);
    for (const [id, spec] of entries(liveUi)) {
      if (JSON.stringify(spec).includes("{{")) renderUiContent(id);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function richText(value) {
    return escapeHtml(template(value))
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
  }

  // ---------- Entorno ----------
  const LIGHTING = {
    studio: [{ type: "ambient", color: "#ffffff", intensity: 0.65 }, { type: "directional", color: "#ffffff", intensity: 0.85, position: "-1 4 2" }, { type: "directional", color: "#cfe0ff", intensity: 0.3, position: "2 2 -3" }],
    day: [{ type: "hemisphere", color: "#dff1ff", groundColor: "#6b5b45", intensity: 0.9 }, { type: "directional", color: "#fff6e5", intensity: 1, position: "3 6 2" }],
    sunset: [{ type: "ambient", color: "#ffb38a", intensity: 0.35 }, { type: "directional", color: "#ff9a5c", intensity: 0.95, position: "-4 2 -3" }, { type: "hemisphere", color: "#ffcfa8", groundColor: "#3a2a4a", intensity: 0.35 }],
    night: [{ type: "ambient", color: "#8aa0ff", intensity: 0.2 }, { type: "directional", color: "#a0b4ff", intensity: 0.35, position: "1 5 1" }],
    none: [],
  };

  function applyEnvironment(env) {
    const environment = env || {};
    scene.setAttribute("background", { color: environment.sky || "#101827" });
    if (environment.floor === null) floor.setAttribute("visible", false);
    else {
      floor.setAttribute("visible", true);
      floor.setAttribute("material", { color: environment.floor || "#253748", roughness: 1 });
    }
    if (environment.fog) scene.setAttribute("fog", { type: "linear", color: environment.fog.color || environment.sky || "#101827", near: environment.fog.near ?? 5, far: environment.fog.far ?? 40 });
    else scene.removeAttribute("fog");
    const preset = LIGHTING[environment.lighting] || LIGHTING.studio;
    while (lights.firstChild) lights.removeChild(lights.firstChild);
    for (const light of preset) {
      const el = document.createElement("a-entity");
      const { position, ...props } = light;
      el.setAttribute("light", props);
      if (position) el.setAttribute("position", position);
      lights.appendChild(el);
    }
    const player = Array.isArray(environment.player) ? environment.player : [0, 0, 0];
    rig.setAttribute("position", player.join(" "));
    if (Array.isArray(environment.lookAt)) {
      // Orienta al jugador hacia un punto en el arranque.
      const [x, , z] = environment.lookAt;
      const angle = Math.atan2(player[0] - x, player[2] - z) * 180 / Math.PI;
      rig.setAttribute("rotation", `0 ${angle} 0`);
    } else rig.setAttribute("rotation", "0 0 0");
  }

  // ---------- Entidades ----------
  const GEOMETRY = {
    box: size => ({ primitive: "box", width: size[0], height: size[1], depth: size[2] }),
    sphere: (_, radius) => ({ primitive: "sphere", radius }),
    cylinder: (size, radius) => ({ primitive: "cylinder", radius, height: size[1] }),
    cone: (size, radius) => ({ primitive: "cone", radiusBottom: radius, radiusTop: 0, height: size[1] }),
    plane: size => ({ primitive: "plane", width: size[0], height: size[1] }),
    circle: (_, radius) => ({ primitive: "circle", radius }),
    ring: (_, radius) => ({ primitive: "ring", radiusInner: radius * 0.6, radiusOuter: radius }),
    torus: (_, radius) => ({ primitive: "torus", radius, radiusTubular: Math.max(0.02, radius * 0.15) }),
    torusKnot: (_, radius) => ({ primitive: "torusKnot", radius, radiusTubular: Math.max(0.02, radius * 0.12) }),
    tetrahedron: (_, radius) => ({ primitive: "tetrahedron", radius }),
    octahedron: (_, radius) => ({ primitive: "octahedron", radius }),
    dodecahedron: (_, radius) => ({ primitive: "dodecahedron", radius }),
    icosahedron: (_, radius) => ({ primitive: "icosahedron", radius }),
    image: size => ({ primitive: "plane", width: size[0], height: size[1] }),
  };

  function isInteractive(spec) {
    if (spec.interactive !== undefined) return Boolean(spec.interactive);
    return Boolean(spec.on && (spec.on.click || spec.on.hover || spec.on.leave));
  }

  function entityAttributes(spec) {
    const attrs = {};
    const size = spec.size || [1, 1, 1];
    const radius = spec.radius ?? 0.5;
    if (spec.position) attrs.position = spec.position.join(" ");
    if (spec.rotation) attrs.rotation = spec.rotation.join(" ");
    if (spec.scale) attrs.scale = spec.scale.join(" ");
    if (spec.visible === false) attrs.visible = false;
    const geometry = GEOMETRY[spec.shape];
    if (geometry) {
      attrs.geometry = geometry(size, radius);
      const material = { color: spec.color || "#ffffff" };
      if (spec.opacity !== undefined && spec.opacity < 1) { material.opacity = spec.opacity; material.transparent = true; }
      if (spec.metalness !== undefined) material.metalness = spec.metalness;
      if (spec.roughness !== undefined) material.roughness = spec.roughness;
      if (spec.emissive) { material.emissive = spec.emissive; material.emissiveIntensity = spec.emissiveIntensity ?? 1; }
      if (spec.wireframe) material.wireframe = true;
      if (spec.shape === "image" || spec.texture) material.src = spec.shape === "image" ? spec.url : spec.texture;
      if (spec.shape === "image" || spec.shape === "plane" || spec.shape === "circle" || spec.shape === "ring") material.side = "double";
      if (spec.flatShading) material.flatShading = true;
      attrs.material = material;
    }
    if (spec.shape === "text") {
      attrs.text = { value: template(spec.text || ""), align: spec.align || "center", color: spec.color || "#ffffff", width: spec.size ? spec.size[0] * 4 : 4, wrapCount: spec.wrapCount || 40 };
    }
    if (spec.shape === "model" && spec.url) attrs["gltf-model"] = spec.url;
    if (spec.shape === "sound" && spec.url) attrs.sound = { src: `url(${spec.url})`, autoplay: Boolean(spec.autoplay), loop: Boolean(spec.loop), positional: true };
    if (spec.shape === "light") attrs.light = { type: spec.lightType || "point", color: spec.color || "#ffffff", intensity: spec.intensity ?? 1, distance: spec.distance ?? 0 };
    if (spec.label && spec.shape !== "text") {
      // Las etiquetas viven en una entidad hija que se maneja aparte.
    }
    for (const [name, value] of entries(spec.components)) attrs[name] = value;
    return attrs;
  }

  function setAttr(el, name, value) {
    if (value !== null && typeof value === "object") el.setAttribute(name, value);
    else el.setAttribute(name, value);
  }

  function entityClasses(id, spec) {
    const classes = ["pb-entity"];
    if (isInteractive(spec)) classes.push("pb-interactive");
    for (const tag of spec.tags || []) classes.push(`pb-tag-${tag}`);
    return classes.join(" ");
  }

  function syncLabel(el, spec) {
    let label = el.querySelector(":scope > .pb-label");
    if (!spec.label) { if (label) label.remove(); return; }
    if (!label) {
      label = document.createElement("a-entity");
      label.className = "pb-label";
      el.appendChild(label);
    }
    const height = spec.shape === "box" || spec.shape === "cylinder" || spec.shape === "cone" ? (spec.size || [1, 1, 1])[1] / 2 : spec.radius ?? 0.5;
    label.setAttribute("position", `0 ${height + 0.25} 0`);
    label.setAttribute("text", { value: template(spec.label), align: "center", color: spec.labelColor || "#ffffff", width: 3, wrapCount: 24 });
    label.setAttribute("look-at-camera", "");
  }

  function createEntity(id, spec) {
    const el = document.createElement("a-entity");
    el.id = `pb-e-${id}`;
    el.dataset.pbId = id;
    el.className = entityClasses(id, spec);
    for (const [name, value] of Object.entries(entityAttributes(spec))) {
      try { setAttr(el, name, value); }
      catch (error) { report(error, `entidad ${id}.${name}`); }
    }
    el.addEventListener("click", event => {
      if (event.target !== el && event.target.closest(".pb-entity") !== el) return;
      fire(id, "click", { point: event.detail?.intersection?.point });
    });
    el.addEventListener("mouseenter", event => { if (event.target === el) fire(id, "hover"); });
    el.addEventListener("mouseleave", event => { if (event.target === el) fire(id, "leave"); });
    el.addEventListener("model-error", () => report(new Error(`No se pudo cargar el modelo ${spec.url}`), `entidad ${id}`));
    syncLabel(el, spec);
    return el;
  }

  function patchEntity(id, prevSpec, nextSpec) {
    const el = entityEl(id);
    if (!el) return;
    const prevAttrs = entityAttributes(prevSpec);
    const nextAttrs = entityAttributes(nextSpec);
    for (const name of Object.keys(prevAttrs)) {
      if (!(name in nextAttrs)) {
        if (name === "visible") el.setAttribute("visible", true);
        else el.removeAttribute(name);
      }
    }
    for (const [name, value] of Object.entries(nextAttrs)) {
      if (same(prevAttrs[name], value)) continue;
      try {
        if (name !== "position" && name !== "rotation" && name !== "scale" && name !== "visible") el.removeAttribute(name);
        setAttr(el, name, value);
      } catch (error) { report(error, `entidad ${id}.${name}`); }
    }
    el.className = entityClasses(id, nextSpec);
    syncLabel(el, nextSpec);
  }

  function entityEl(id) { return document.getElementById(`pb-e-${id}`); }

  function buildEntities(entities) {
    const created = [];
    const pending = new Map(entries(entities));
    let progress = true;
    while (pending.size && progress) {
      progress = false;
      for (const [id, spec] of [...pending]) {
        const parent = spec.parent ? entityEl(spec.parent) : content;
        if (spec.parent && !parent && pending.has(spec.parent)) continue;
        const el = createEntity(id, spec);
        (parent || content).appendChild(el);
        created.push(el);
        pending.delete(id);
        progress = true;
      }
    }
    return created;
  }

  function clearEntities() {
    while (content.firstChild) content.removeChild(content.firstChild);
  }

  // ---------- Interfaz ----------
  function zoneEl(zone) {
    return uiRoot.querySelector(`.pb-zone[data-zone="${ZONES.includes(zone) ? zone : "top-left"}"]`);
  }

  function uiEl(id) { return uiRoot.querySelector(`[data-pb-ui="${CSS.escape(id)}"]`); }

  function applyUiFrame(id, el, spec) {
    el.className = `pb-item pb-${spec.type}${spec.className ? ` ${spec.className}` : ""}`;
    el.hidden = Boolean(spec.hidden);
    el.removeAttribute("style");
    if (typeof spec.style === "string") el.style.cssText = spec.style;
    else for (const [property, value] of entries(spec.style)) {
      if (property.startsWith("--") || property.includes("-")) el.style.setProperty(property, String(value));
      else el.style[property] = String(value);
    }
    el.style.order = spec.order !== undefined ? String(spec.order) : "";
    const parent = spec.parent ? uiEl(spec.parent)?.querySelector(":scope > .pb-children, :scope .pb-children") : null;
    const container = parent || zoneEl(spec.zone);
    if (el.parentElement !== container) container.appendChild(el);
  }

  function renderUiContent(id) {
    const el = uiEl(id);
    const spec = liveUi[id];
    if (!el || !spec) return;
    const keepChildren = el.querySelector(":scope > .pb-panel > .pb-children");
    const children = keepChildren ? [...keepChildren.children] : [];
    el.textContent = "";
    switch (spec.type) {
      case "panel": {
        const panel = document.createElement("div");
        panel.className = "pb-panel";
        panel.innerHTML = `${spec.title ? `<h2 class="pb-title">${richText(spec.title)}</h2>` : ""}${spec.text ? `<p class="pb-text">${richText(spec.text)}</p>` : ""}<div class="pb-children"></div>`;
        const slot = panel.querySelector(".pb-children");
        for (const child of children) slot.appendChild(child);
        el.appendChild(panel);
        break;
      }
      case "text": {
        const block = document.createElement("div");
        block.className = "pb-textblock";
        block.innerHTML = richText(spec.text || "");
        el.appendChild(block);
        break;
      }
      case "button": {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pb-button";
        button.innerHTML = richText(spec.label || spec.text || "Botón");
        button.addEventListener("click", () => fire(id, "click"));
        el.appendChild(button);
        break;
      }
      case "slider": {
        const field = document.createElement("label");
        field.className = "pb-field";
        const value = spec.value ?? spec.min ?? 0;
        field.innerHTML = `<span>${richText(spec.label || "")} <output>${escapeHtml(value)}</output></span>`;
        const input = document.createElement("input");
        input.type = "range";
        input.min = String(spec.min ?? 0);
        input.max = String(spec.max ?? 100);
        input.step = String(spec.step ?? 1);
        input.value = String(value);
        input.addEventListener("input", () => {
          field.querySelector("output").textContent = input.value;
          spec.value = Number(input.value);
          fire(id, "change", Number(input.value));
        });
        field.appendChild(input);
        el.appendChild(field);
        break;
      }
      case "toggle": {
        const field = document.createElement("label");
        field.className = "pb-field pb-field-row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(spec.checked);
        input.addEventListener("change", () => { spec.checked = input.checked; fire(id, "change", input.checked); });
        field.appendChild(input);
        field.insertAdjacentHTML("beforeend", `<span>${richText(spec.label || "")}</span>`);
        el.appendChild(field);
        break;
      }
      case "select": {
        const field = document.createElement("label");
        field.className = "pb-field";
        field.innerHTML = `<span>${richText(spec.label || "")}</span>`;
        const select = document.createElement("select");
        for (const option of spec.options || []) {
          const item = typeof option === "object" ? option : { value: option, label: option };
          const el2 = document.createElement("option");
          el2.value = String(item.value);
          el2.textContent = template(item.label ?? item.value);
          select.appendChild(el2);
        }
        if (spec.value !== undefined) select.value = String(spec.value);
        select.addEventListener("change", () => { spec.value = select.value; fire(id, "change", select.value); });
        field.appendChild(select);
        el.appendChild(field);
        break;
      }
      case "progress": {
        const field = document.createElement("div");
        field.className = "pb-field";
        field.innerHTML = `<span>${richText(spec.label || "")}</span><progress max="${escapeHtml(spec.max ?? 100)}" value="${escapeHtml(spec.value ?? 0)}"></progress>`;
        el.appendChild(field);
        break;
      }
      case "image": {
        const image = document.createElement("img");
        image.src = spec.url || "";
        image.alt = template(spec.label || "");
        el.appendChild(image);
        break;
      }
      case "html": {
        el.innerHTML = spec.html || "";
        break;
      }
    }
    if (scene.is && scene.is("vr-mode")) buildXrUi();
  }

  function buildUi(ui) {
    for (const zone of uiRoot.querySelectorAll(".pb-zone")) zone.textContent = "";
    liveUi = clone(ui) || {};
    // Primero los contenedores, después los hijos, para que cada hijo encuentre su panel.
    const ordered = Object.keys(liveUi).sort((a, b) => depthOf(a) - depthOf(b));
    for (const id of ordered) {
      const el = document.createElement("div");
      el.dataset.pbUi = id;
      applyUiFrame(id, el, liveUi[id]);
      renderUiContent(id);
    }
  }

  function uiDepth(ui, id, seen = new Set()) {
    const spec = ui && ui[id];
    if (!spec || !spec.parent || seen.has(id)) return 0;
    seen.add(id);
    return 1 + uiDepth(ui, spec.parent, seen);
  }

  function depthOf(id) { return uiDepth(liveUi, id); }

  function patchUi(id, nextSpec) {
    const el = uiEl(id);
    if (!el) return;
    liveUi[id] = clone(nextSpec);
    applyUiFrame(id, el, liveUi[id]);
    renderUiContent(id);
  }

  // ---------- UI dentro de la escena en modo inmersivo ----------
  function buildXrUi() {
    while (xrRoot.firstChild) xrRoot.removeChild(xrRoot.firstChild);
    if (!scene.is("vr-mode")) return;
    let y = 0;
    const rows = [];
    for (const [id, spec] of entries(liveUi)) {
      if (spec.hidden || spec.xr === false || !["panel", "text", "button", "toggle"].includes(spec.type)) continue;
      rows.push([id, spec]);
    }
    for (const [id, spec] of rows) {
      const isButton = spec.type === "button" || spec.type === "toggle";
      const text = template(spec.type === "panel" ? [spec.title, spec.text].filter(Boolean).join("\n") : spec.label || spec.text || "");
      if (!text) continue;
      const lines = Math.max(1, Math.ceil(text.length / 42) + (text.match(/\n/g) || []).length);
      const height = isButton ? 0.14 : 0.08 * lines + 0.08;
      const row = document.createElement("a-entity");
      row.setAttribute("geometry", { primitive: "plane", width: 1.1, height });
      row.setAttribute("material", { color: isButton ? "#2563eb" : "#071222", opacity: 0.92, transparent: true, shader: "flat" });
      row.setAttribute("position", `0 ${y - height / 2} 0`);
      row.setAttribute("text", { value: text.replace(/\*\*/g, ""), align: isButton ? "center" : "left", color: "#ffffff", width: 1.0, wrapCount: 42, xOffset: isButton ? 0 : 0.03 });
      if (isButton) {
        row.classList.add("pb-interactive");
        row.addEventListener("click", () => {
          if (spec.type === "toggle") { spec.checked = !spec.checked; fire(id, "change", spec.checked); }
          else fire(id, "click");
        });
      }
      xrRoot.appendChild(row);
      y -= height + 0.03;
    }
  }

  // ---------- Acciones declarativas ----------
  function resolveTargets(target, self) {
    const key = target === undefined || target === "self" ? self : String(target);
    if (!key) return [];
    if (key.startsWith("tag:")) return [...content.querySelectorAll(`.pb-tag-${CSS.escape(key.slice(4))}`)].map(el => ({ kind: "entity", id: el.dataset.pbId, el }));
    if (current.entities[key] || entityEl(key)) return [{ kind: "entity", id: key, el: entityEl(key) }];
    if (liveUi[key]) return [{ kind: "ui", id: key, el: uiEl(key) }];
    return [];
  }

  function setOnEntity(el, prop, value) {
    if (!el) return;
    const vector = Array.isArray(value) ? value.join(" ") : value;
    if (prop === "color") el.setAttribute("material", "color", value);
    else if (prop === "opacity") { el.setAttribute("material", "opacity", value); el.setAttribute("material", "transparent", value < 1); }
    else if (prop === "text") el.setAttribute("text", "value", template(value));
    else if (prop === "visible") el.setAttribute("visible", Boolean(value));
    else if (prop === "position" || prop === "rotation" || prop === "scale") el.setAttribute(prop, vector);
    else if (prop.includes(".")) {
      const [component, property] = prop.split(".", 2);
      el.setAttribute(component, property, value);
    } else el.setAttribute(prop, value);
  }

  function setOnUi(id, prop, value) {
    const spec = liveUi[id];
    if (!spec) return;
    if (prop.startsWith("style.")) {
      spec.style = typeof spec.style === "object" && spec.style ? spec.style : {};
      spec.style[prop.slice(6)] = value;
      applyUiFrame(id, uiEl(id), spec);
      return;
    }
    spec[prop] = value;
    if (prop === "hidden" || prop === "zone" || prop === "className" || prop === "order") applyUiFrame(id, uiEl(id), spec);
    else renderUiContent(id);
  }

  function set(target, prop, value, self) {
    for (const item of resolveTargets(target, self)) {
      try {
        if (item.kind === "entity") setOnEntity(item.el, prop, value);
        else setOnUi(item.id, prop, value);
      } catch (error) { report(error, `set ${item.id}.${prop}`); }
    }
  }

  function showMessage(text, duration) {
    messageEl.innerHTML = richText(text);
    messageEl.classList.add("visible");
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => messageEl.classList.remove("visible"), duration || 6000);
  }

  function run(actions, self, detail) {
    for (const action of Array.isArray(actions) ? actions : [actions]) {
      if (!action || typeof action !== "object") continue;
      try {
        switch (action.do) {
          case "emit": emit(action.event, action.detail ?? detail); break;
          case "set": set(action.target, action.prop, action.value, self); break;
          case "toggle":
            for (const item of resolveTargets(action.target, self)) {
              if (item.kind === "entity" && item.el) item.el.setAttribute("visible", !item.el.getAttribute("visible"));
              else if (item.kind === "ui") setOnUi(item.id, "hidden", !liveUi[item.id].hidden);
            }
            break;
          case "show":
          case "hide":
            for (const item of resolveTargets(action.target, self)) {
              const visible = action.do === "show";
              if (item.kind === "entity") setOnEntity(item.el, "visible", visible);
              else setOnUi(item.id, "hidden", !visible);
            }
            break;
          case "message": showMessage(action.text, action.duration); break;
          case "animate":
            for (const item of resolveTargets(action.target, self)) {
              if (item.kind !== "entity" || !item.el) continue;
              const property = action.property || "rotation";
              const to = Array.isArray(action.to) ? action.to.join(" ") : action.to;
              const name = `animation__pb_${property.replace(/[^\w]/g, "_")}`;
              item.el.removeAttribute(name);
              item.el.setAttribute(name, { property, to, from: Array.isArray(action.from) ? action.from.join(" ") : action.from, dur: action.dur ?? 1000, loop: action.loop ?? false, dir: action.dir || "normal", easing: action.easing || "easeInOutQuad" });
            }
            break;
          case "stop":
            for (const item of resolveTargets(action.target, self)) {
              if (!item.el) continue;
              for (const name of Object.keys(item.el.components || {})) if (name.startsWith("animation")) item.el.removeAttribute(name);
            }
            break;
          case "state": {
            const previous = Number(state[action.key]) || 0;
            setState(action.key, action.inc !== undefined ? previous + Number(action.inc) : action.value);
            break;
          }
          default: report(new Error(`Acción desconocida: ${action.do}`), `acción de ${self}`);
        }
      } catch (error) { report(error, `acción ${action.do} de ${self}`); }
    }
  }

  function fire(id, type, detail) {
    emit(`${type}:${id}`, detail);
  }

  function syncDeclarativeHandlers() {
    while (declarativeHandlers.length) declarativeHandlers.pop()();
    const register = (id, on) => {
      for (const [eventName, actions] of entries(on)) {
        const busName = LOCAL_EVENTS.includes(eventName) ? `${eventName}:${id}` : eventName;
        listen(busName, detail => run(actions, id, detail), declarativeHandlers);
      }
    };
    for (const [id, spec] of entries(current.entities)) register(id, spec.on);
    for (const [id, spec] of entries(current.ui)) register(id, spec.on);
  }

  // ---------- Scripts ----------
  if (window.AFRAME && !AFRAME.components["pb-ticker"]) {
    AFRAME.registerComponent("pb-ticker", {
      tick(time, delta) {
        for (const fn of tickers) {
          try { fn(time, delta); }
          catch (error) { tickers.delete(fn); report(error, "onTick"); }
        }
      },
    });
  }
  if (window.AFRAME && !AFRAME.components["look-at-camera"]) {
    AFRAME.registerComponent("look-at-camera", {
      tick() {
        const cameraObject = this.el.sceneEl.camera;
        if (!cameraObject) return;
        const target = new AFRAME.THREE.Vector3();
        cameraObject.getWorldPosition(target);
        this.el.object3D.lookAt(target);
      },
    });
  }

  function loadScript(url) {
    if (!loadedScripts.has(url)) {
      loadedScripts.set(url, new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => { loadedScripts.delete(url); reject(new Error(`No se pudo cargar ${url}`)); };
        document.head.appendChild(script);
      }));
    }
    return loadedScripts.get(url);
  }

  function spawn(spec, parentId) {
    const id = spec.id || `spawn-${Math.random().toString(36).slice(2, 9)}`;
    const el = createEntity(id, spec);
    const parent = parentId ? entityEl(parentId) : content;
    (parent || content).appendChild(el);
    return el;
  }

  function createContext(scriptId, scope) {
    return {
      AFRAME: window.AFRAME,
      THREE: window.AFRAME && AFRAME.THREE,
      scene,
      root: content,
      camera,
      rig,
      doc: clone(current),
      state,
      entity: id => entityEl(id),
      entities: tag => [...content.querySelectorAll(`.pb-tag-${CSS.escape(tag)}`)],
      ui: id => uiEl(id),
      value: id => liveUi[id]?.value ?? liveUi[id]?.checked,
      on: (name, fn) => listen(name, fn, scope.offs),
      emit,
      onTick: fn => { tickers.add(fn); scope.offs.push(() => tickers.delete(fn)); },
      after: (ms, fn) => { const timer = setTimeout(() => { try { fn(); } catch (error) { report(error, `script ${scriptId}`); } }, ms); scope.offs.push(() => clearTimeout(timer)); return timer; },
      every: (ms, fn) => { const timer = setInterval(() => { try { fn(); } catch (error) { report(error, `script ${scriptId}`); } }, ms); scope.offs.push(() => clearInterval(timer)); return timer; },
      run: (actions, self) => run(actions, self || scriptId),
      set: (target, prop, value) => set(target, prop, value, scriptId),
      setState,
      message: showMessage,
      spawn: (spec, parentId) => { const el = spawn(spec, parentId); scope.offs.push(() => el.remove()); return el; },
      loadScript,
      import: url => import(url),
      registerComponent: (name, definition) => {
        if (AFRAME.components[name]) {
          if (!scriptComponentNames.has(name)) throw new Error(`El componente ${name} ya existe en la base; usa otro nombre.`);
          delete AFRAME.components[name];
        }
        AFRAME.registerComponent(name, definition);
        scriptComponentNames.add(name);
        scope.components.add(name);
      },
      cleanup: fn => scope.offs.push(fn),
    };
  }

  function disposeScripts() {
    for (const scope of scriptScopes.reverse()) {
      for (const off of scope.offs.reverse()) {
        try { off(); } catch (error) { report(error, `limpieza de ${scope.id}`); }
      }
    }
    scriptScopes = [];
    tickers.clear();
  }

  function runScripts(scripts) {
    const registered = new Set();
    const sorted = entries(scripts).sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0));
    for (const [id, spec] of sorted) {
      const scope = { id, offs: [], components: new Set() };
      scriptScopes.push(scope);
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function("ctx", `"use strict";\n${spec.code}\n//# sourceURL=profeia-script-${id}.js`);
        const result = fn(createContext(id, scope));
        if (typeof result === "function") scope.offs.push(result);
        else if (result && typeof result.then === "function") result.catch(error => report(error, `script ${id}`));
      } catch (error) {
        report(error, `script ${id}`);
      }
      for (const name of scope.components) registered.add(name);
    }
    return registered;
  }

  // Un componente registrado por un script después de crear las entidades no se inicializa solo:
  // se vuelve a poner en cada entidad que lo usa.
  function upgradeComponents(entities, names) {
    for (const [id, spec] of entries(entities)) {
      const el = entityEl(id);
      if (!el) continue;
      for (const [name, value] of entries(spec.components)) {
        if (!names.has(name.split("__")[0])) continue;
        try { el.removeAttribute(name); setAttr(el, name, value); }
        catch (error) { report(error, `entidad ${id}.${name}`); }
      }
    }
  }

  function waitLoaded(elements) {
    return Promise.race([
      Promise.all(elements.map(el => el.hasLoaded ? null : new Promise(resolve => el.addEventListener("loaded", resolve, { once: true })))),
      new Promise(resolve => setTimeout(resolve, 2000)),
    ]);
  }

  // ---------- Aplicar un documento ----------
  function onlyKeysChanged(prev, next, rebuildKeys) {
    return rebuildKeys.every(key => same(prev[key], next[key]));
  }

  async function applyDocument(next, options) {
    const prev = current;
    const draft = Boolean(options.draft);
    const full = Boolean(options.full);
    document.title = next.title || "Experiencia WebXR";

    for (const id of new Set([...Object.keys(prev.styles || {}), ...Object.keys(next.styles || {})])) {
      if (!full && same(prev.styles?.[id], next.styles?.[id])) continue;
      let style = document.head.querySelector(`style[data-pb-style="${CSS.escape(id)}"]`);
      if (next.styles?.[id] === undefined) { style?.remove(); continue; }
      if (!style) { style = document.createElement("style"); style.dataset.pbStyle = id; document.head.appendChild(style); }
      style.textContent = next.styles[id];
    }
    if (full || !same(prev.environment, next.environment)) applyEnvironment(next.environment);

    const hasScripts = Object.keys(prev.scripts || {}).length > 0 || Object.keys(next.scripts || {}).length > 0;
    // Un borrador no corre scripts: el primer documento final después de borradores siempre los arranca.
    let structural = full || !same(prev.scripts, next.scripts) || (!draft && Object.keys(next.scripts || {}).length > 0 && !scriptsLive);
    const entityIds = new Set([...Object.keys(prev.entities || {}), ...Object.keys(next.entities || {})]);
    const uiIds = new Set([...Object.keys(prev.ui || {}), ...Object.keys(next.ui || {})]);
    if (!structural) {
      for (const id of entityIds) {
        const a = prev.entities?.[id];
        const b = next.entities?.[id];
        if (!a || !b ? a !== b : !onlyKeysChanged(a, b, ENTITY_REBUILD_KEYS)) { structural = true; break; }
      }
    }
    if (!structural) {
      for (const id of uiIds) {
        const a = prev.ui?.[id];
        const b = next.ui?.[id];
        if (!a || !b ? a !== b : !onlyKeysChanged(a, b, UI_REBUILD_KEYS)) { structural = true; break; }
      }
    }
    // Con scripts, cualquier cambio estructural reinicia la experiencia para que el código vea la escena nueva.
    current = clone(next);

    if (structural && (full || hasScripts)) {
      disposeScripts();
      scriptsLive = false;
      state = {};
      buildUi(next.ui);
      clearEntities();
      const created = buildEntities(next.entities);
      syncDeclarativeHandlers();
      if (!draft) {
        await waitLoaded(created);
        const registered = runScripts(next.scripts);
        upgradeComponents(next.entities, registered);
        scriptsLive = true;
      }
    } else {
      // Interfaz: cambiar zona, estilo o texto mantiene el mismo elemento; agregar, quitar o cambiar tipo la rearma.
      let uiStructural = false;
      for (const id of uiIds) {
        const a = prev.ui?.[id];
        const b = next.ui?.[id];
        if (!a || !b || a.type !== b.type) { uiStructural = true; break; }
      }
      if (uiStructural) buildUi(next.ui);
      else {
        const ordered = [...uiIds].sort((a, b) => uiDepth(next.ui, a) - uiDepth(next.ui, b));
        for (const id of ordered) if (!same(prev.ui[id], next.ui[id])) patchUi(id, next.ui[id]);
      }
      // Escena 3D: color, posición o componentes se cambian en el mismo elemento; lo demás rearma las entidades.
      let entityStructural = false;
      for (const id of entityIds) {
        const a = prev.entities?.[id];
        const b = next.entities?.[id];
        if (!a || !b || !onlyKeysChanged(a, b, ENTITY_REBUILD_KEYS) || !entityEl(id)) { entityStructural = true; break; }
      }
      if (entityStructural) {
        clearEntities();
        buildEntities(next.entities);
      } else {
        for (const id of entityIds) if (!same(prev.entities[id], next.entities[id])) patchEntity(id, prev.entities[id], next.entities[id]);
      }
      syncDeclarativeHandlers();
    }
    if (scene.is("vr-mode")) buildXrUi();
    if (!draft) {
      emit("ready", { full, structural });
      document.dispatchEvent(new CustomEvent("profeia-base:ready"));
    }
  }

  // Los cambios llegan en ráfagas mientras el modelo escribe: se aplican en orden y solo el último pendiente.
  let applying = Promise.resolve();
  let queued = null;
  function enqueue(doc, options) {
    const wasIdle = queued === null;
    queued = { doc, options };
    if (!wasIdle) return applying;
    applying = applying.then(async () => {
      const job = queued;
      queued = null;
      if (!job) return;
      try { await applyDocument(job.doc, job.options); }
      catch (error) { report(error, "base"); }
    });
    return applying;
  }

  function validDoc(value) {
    return value && typeof value === "object" && value.version === 2 && typeof value.entities === "object" && typeof value.ui === "object";
  }

  addEventListener("message", event => {
    if (event.source !== window.parent || window.parent === window) return;
    const data = event.data;
    if (!data || data.namespace !== BASE_NS || data.type !== "apply" || !validDoc(data.doc)) return;
    if (typeof data.runId === "string" && !data.draft) window.__profeiaPreview?.setRunId(data.runId);
    enqueue(data.doc, { draft: Boolean(data.draft) });
  });

  function start() {
    scene.setAttribute("pb-ticker", "");
    scene.addEventListener("enter-vr", () => { buildXrUi(); emit("enter-vr"); });
    scene.addEventListener("exit-vr", () => { buildXrUi(); emit("exit-vr"); });
    let initial;
    try { initial = JSON.parse(docEl.textContent); }
    catch (error) { report(error, "documento de la base"); return; }
    enqueue(initial, { full: true }).then(() => {
      if (window.parent !== window) window.parent.postMessage({ namespace: BASE_NS, type: "hello", version: RUNTIME_VERSION }, "*");
    });
  }

  window.ProfeIABase = { version: RUNTIME_VERSION, emit, on: (name, fn) => listen(name, fn), state: () => state, doc: () => clone(current) };

  if (!window.AFRAME || !scene) {
    addEventListener("load", () => { document.getElementById("pb-fallback").hidden = false; });
    return;
  }
  if (scene.hasLoaded) start();
  else scene.addEventListener("loaded", start, { once: true });
})();
