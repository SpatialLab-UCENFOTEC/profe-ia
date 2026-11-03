import type { PreviewDiagnostic } from "../previewDiagnostics";
import type { PreviewStatus } from "../types";

export type DevScenarioId =
  | "success"
  | "missing-response"
  | "missing-code"
  | "empty"
  | "corrections"
  | "generating"
  | "checking"
  | "repairing"
  | "repair-applied"
  | "patching"
  | "patch-applied"
  | "repair-failed";

export interface DevScenario {
  id: DevScenarioId;
  label: string;
  question: string;
  response?: string;
  html?: string;
  /** Versión anterior del documento: anima el diff rojo → verde al cargar el escenario. */
  previousHtml?: string;
  /** Diagnóstico que se simula como recibido del iframe. */
  diagnostic?: PreviewDiagnostic;
  corrections?: string[];
  status: PreviewStatus;
  error?: string;
}

// Varias líneas para que el escaneo y los diffs del código fantasma se vean. No incluye el monitor de
// diagnósticos, así que ningún escenario dispara chequeos ni reparaciones reales.
export const DEV_EXPERIENCE_HTML = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <title>Experiencia de auditoría</title>
  <style>
    body {
      margin: 0;
      display: grid;
      place-items: center;
      min-height: 100vh;
      background: radial-gradient(circle at top, #164a98, #08090f);
      color: white;
      font-family: system-ui;
    }
    main { text-align: center; }
    .planet { font-size: 5rem; }
  </style>
</head>
<body>
  <main>
    <div class="planet">🪐</div>
    <h1>Sistema solar interactivo</h1>
    <p>Arrastra para explorar la escena.</p>
  </main>
  <script>
    const planet = document.querySelector(".planet");
    let angle = 0;
    function spin() {
      angle = (angle + 0.4) % 360;
      planet.style.transform = \`rotate(\${angle}deg)\`;
      requestAnimationFrame(spin);
    }
    spin();
  </script>
</body>
</html>`;

const DEV_BROKEN_HTML = DEV_EXPERIENCE_HTML.replace(
  "    let angle = 0;",
  "    const controller = new XRController(planet);\n    let angle = controller.angle;",
);
const DEV_BROKEN_LINE = DEV_BROKEN_HTML.split("\n").findIndex(line => line.includes("XRController")) + 1;

const DEV_PATCHED_HTML = DEV_EXPERIENCE_HTML
  .replace("background: radial-gradient(circle at top, #164a98, #08090f);", "background: radial-gradient(circle at top, #4c1d95, #08090f);")
  .replace("    <p>Arrastra para explorar la escena.</p>", "    <p>Arrastra para explorar la escena.</p>\n    <p>El cielo ahora es violeta.</p>");

const XR_CONTROLLER_ERROR: PreviewDiagnostic = {
  type: "runtime-error",
  details: { message: "ReferenceError: XRController is not defined", filename: "experience.html", line: DEV_BROKEN_LINE },
};

const SOLAR = "Crea un sistema solar interactivo.";

export const DEV_SCENARIOS: DevScenario[] = [
  { id: "success", label: "Código + respuesta", question: SOLAR, response: "Creé un sistema solar interactivo. Arrastra para rotar la vista y selecciona un planeta para conocerlo.", html: DEV_EXPERIENCE_HTML, status: "ready" },
  { id: "missing-response", label: "Sin respuesta", question: SOLAR, html: DEV_EXPERIENCE_HTML, status: "repairing", diagnostic: { type: "missing-response", details: {} } },
  { id: "missing-code", label: "Sin código", question: SOLAR, response: "Preparé la experiencia solicitada, pero la respuesta no incluyó el documento HTML.", status: "idle", error: "La respuesta no contiene el código de la experiencia solicitado." },
  { id: "empty", label: "Sin ninguno", question: SOLAR, status: "idle", error: "El modelo no devolvió código ni una respuesta para mostrar." },
  { id: "corrections", label: "Con correcciones", question: SOLAR, response: "La experiencia está lista. Arrastra para explorar y selecciona los planetas para ver sus datos.", html: DEV_EXPERIENCE_HTML, corrections: ["Se corrigió una referencia inexistente al control de cámara.", "Se añadió una alternativa cuando WebXR no está disponible."], status: "ready" },
  { id: "generating", label: "Generando", question: SOLAR, response: "Estoy preparando la escena y sus interacciones…", html: DEV_EXPERIENCE_HTML.slice(0, 330), status: "generating" },
  { id: "checking", label: "Revisando", question: SOLAR, html: DEV_EXPERIENCE_HTML, status: "checking" },
  { id: "repairing", label: "Perfeccionando", question: SOLAR, html: DEV_BROKEN_HTML, status: "repairing", diagnostic: XR_CONTROLLER_ERROR },
  { id: "repair-applied", label: "Reparación aplicada", question: SOLAR, html: DEV_EXPERIENCE_HTML, previousHtml: DEV_BROKEN_HTML, status: "checking" },
  { id: "patching", label: "Modificando", question: "Cambia el cielo a violeta.", html: DEV_EXPERIENCE_HTML, status: "patching" },
  { id: "patch-applied", label: "Parche aplicado", question: "Cambia el cielo a violeta.", html: DEV_PATCHED_HTML, previousHtml: DEV_EXPERIENCE_HTML, status: "checking" },
  { id: "repair-failed", label: "Corrección fallida", question: "Crea una experiencia con modelos 3D externos.", response: "Creé una galería inmersiva con modelos 3D.", html: DEV_BROKEN_HTML, status: "repair-failed", diagnostic: XR_CONTROLLER_ERROR, error: "La experiencia sigue presentando errores después de dos intentos automáticos. Revisa los detalles o solicita un cambio manual." },
];
