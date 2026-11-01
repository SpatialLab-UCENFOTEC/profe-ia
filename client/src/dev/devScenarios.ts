import type { PreviewStatus } from "../types";

export type DevScenarioId = "success" | "missing-response" | "missing-code" | "empty" | "corrections" | "generating" | "repair-failed";

export interface DevScenario {
  id: DevScenarioId;
  label: string;
  question: string;
  response?: string;
  html?: string;
  corrections?: string[];
  status: PreviewStatus;
  error?: string;
}

export const DEV_EXPERIENCE_HTML = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>Experiencia de auditoría</title></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:radial-gradient(circle at top,#164a98,#08090f);color:white;font-family:system-ui">
  <main style="text-align:center"><div style="font-size:5rem">🪐</div><h1>Sistema solar interactivo</h1><p>Arrastra para explorar la escena.</p></main>
</body>
</html>`;

export const DEV_SCENARIOS: DevScenario[] = [
  { id: "success", label: "Código + respuesta", question: "Crea un sistema solar interactivo.", response: "Creé un sistema solar interactivo. Arrastra para rotar la vista y selecciona un planeta para conocerlo.", html: DEV_EXPERIENCE_HTML, status: "ready" },
  { id: "missing-response", label: "Sin respuesta", question: "Crea un sistema solar interactivo.", html: DEV_EXPERIENCE_HTML, status: "repairing" },
  { id: "missing-code", label: "Sin código", question: "Crea un sistema solar interactivo.", response: "Preparé la experiencia solicitada, pero la respuesta no incluyó el documento HTML.", status: "idle", error: "La respuesta no contiene el código de la experiencia solicitado." },
  { id: "empty", label: "Sin ninguno", question: "Crea un sistema solar interactivo.", status: "idle", error: "El modelo no devolvió código ni una respuesta para mostrar." },
  { id: "corrections", label: "Con correcciones", question: "Crea un sistema solar interactivo.", response: "La experiencia está lista. Arrastra para explorar y selecciona los planetas para ver sus datos.", html: DEV_EXPERIENCE_HTML, corrections: ["Se corrigió una referencia inexistente al control de cámara.", "Se añadió una alternativa cuando WebXR no está disponible."], status: "ready" },
  { id: "generating", label: "Generando", question: "Crea un sistema solar interactivo.", response: "Estoy preparando la escena y sus interacciones…", html: DEV_EXPERIENCE_HTML.slice(0, 330), status: "generating" },
  { id: "repair-failed", label: "Corrección fallida", question: "Crea una experiencia con modelos 3D externos.", response: "Creé una galería inmersiva con modelos 3D.", html: DEV_EXPERIENCE_HTML, status: "repair-failed", error: "La experiencia sigue presentando errores después de dos intentos automáticos. Revisa los detalles o solicita un cambio manual." },
];
