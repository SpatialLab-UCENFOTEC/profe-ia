# AGENTS.md — Frontend (`/client`)

SPA de ProfeIA: un chat que genera experiencias WebXR (HTML completo), las muestra en un iframe, detecta errores en ejecución y le pide al modelo que las corrija automáticamente. React + Vite + Tailwind/daisyUI, en español.

## Comandos

Desde la raíz del repo (workspaces npm):

| Acción | Comando |
|---|---|
| Dev (API en `PORT` o :3000 + Vite en :5173) | `npm run dev` |
| Typecheck del cliente | `npm run typecheck -w client` |
| Tests del cliente | `npm run test -w client` |
| Build | `npm run build -w client` |
| Todo (server + client + typecheck) | `npm test` |

Vite hace proxy de `/api` a `localhost:<PORT>`, así que el servidor debe estar arriba para login y chat. `vite.config.ts` lee `PORT` del `.env` de la raíz (el mismo que usa el servidor) y usa 3000 si no está definido o no es numérico. El código de `src/` nunca debe asumir un puerto: usa siempre rutas relativas (`/api/...`). En producción el servidor sirve `client/dist` desde el mismo origen, sin proxy.

## Estructura

```
src/
├── main.tsx                 # Punto de entrada
├── App.tsx                  # Orquestador (ver "Por qué App.tsx sigue siendo grande")
├── types.ts                 # Message, Role, PreviewMode, PreviewStatus, AuthState, StreamEvent
├── constants.ts             # SUGGESTIONS, MAX_CONTEXT_MESSAGES, MAX_REPAIR_ATTEMPTS, PREVIEW_STARTUP_TIMEOUT_MS
├── streamParser.ts          # WebXrStreamParser: extrae <webxr-html> y <assistant-response> del stream
├── previewDiagnostics.ts    # classifyPreviewDiagnostic + errorsPrompt (prompt de reparación)
├── codeTrace.ts             # diffLines + diagnosticLines (resaltados del código fantasma)
├── collapsibleHeadings.ts   # Plugin rehype: agrupa contenido bajo cada heading para colapsarlo
├── index.css                # Estilos (clases como .chat-pane, .preview-panel, .build-overlay)
├── hooks/
│   └── useAuth.ts
├── dev/
│   └── devScenarios.ts      # Escenarios locales para auditar estados de UI
└── components/
    ├── Icon.tsx
    ├── Markdown.tsx
    ├── AccessScreen.tsx
    ├── DevAuditPanel.tsx
    ├── TopBar.tsx
    ├── chat/
    │   ├── ChatPane.tsx
    │   ├── WelcomeScreen.tsx
    │   ├── MessageList.tsx
    │   ├── MessageItem.tsx
    │   └── Composer.tsx
    └── preview/
        ├── PreviewPanel.tsx
        ├── BuildOverlay.tsx
        └── GhostCode.tsx
test/                        # tsx --test: streamParser, previewDiagnostics, collapsibleHeadings, codeTrace
```

## Responsabilidad de cada pieza

### Núcleo

- **`App.tsx`**: único dueño del estado de la conversación y del preview (mensajes, streaming, estado del preview, diagnósticos, refs/timers de reparación). Contiene `processStream`, `sendMessage`, el manejo de diagnósticos y la reparación automática, `loadDevScenario`, recarga y descarga. Decide qué pantalla mostrar (comprobando / acceso / app) y pasa todo por props a los componentes.
- **`types.ts` / `constants.ts`**: tipos y constantes compartidos. Cualquier tipo usado por más de un archivo va en `types.ts`.
- **`streamParser.ts`**: lógica pura. Va acumulando texto del stream y expone HTML y respuesta parciales o completas. Tiene tests.
- **`previewDiagnostics.ts`**: lógica pura. Clasifica los mensajes del iframe como `fatal`, `warning`, `ignored` o `ready`, genera firmas para deduplicar y construye el prompt de corrección. Tiene tests.
- **`collapsibleHeadings.ts`**: plugin rehype usado por `Markdown` con `collapsible`. Tiene tests.
- **`codeTrace.ts`**: lógica pura. `diffLines` calcula qué líneas salen y cuáles entran entre dos versiones (para animar parches) y `diagnosticLines` extrae las líneas que señalan los errores fatales. Tiene tests.

### Hooks

- **`hooks/useAuth.ts`**: estado de sesión. Consulta `/api/auth/status` al montar, expone `login` (`/api/auth/login`) y `lock(mensaje)` para volver a la pantalla de acceso cuando el chat devuelve 401.

### Componentes de propósito general

- **`Icon.tsx`**: `Icon` (send, expand, download, reload, back) y `TechnicalDetailsIcon`.
- **`Markdown.tsx`**: render de markdown con GFM. Con `collapsible` agrupa por headings (solo para mensajes del modelo).
- **`AccessScreen.tsx`**: formulario de contraseña. Presentacional, sin estado propio.
- **`DevAuditPanel.tsx`**: panel flotante que carga los escenarios de `dev/devScenarios.ts`. Solo se monta con `import.meta.env.DEV`.
- **`TopBar.tsx`**: cabecera (logo, título, botón "Abrir experiencia" cuando el preview está cerrado y hay una experiencia lista).

### Chat (`components/chat/`)

- **`ChatPane.tsx`**: columna izquierda. Compone `TopBar`, el área de conversación y `Composer`. Muestra `WelcomeScreen` si no hay mensajes visibles y `MessageList` si los hay.
- **`WelcomeScreen.tsx`**: pantalla vacía con sugerencias; cada una llama a `onSuggestion`.
- **`MessageList.tsx`**: lista de mensajes y mensaje en streaming. **Es dueño del auto-scroll** (`endRef` + efecto).
- **`MessageItem.tsx`**: exporta `MessageItem` (mensaje con HTML desplegable, markdown y correcciones técnicas) y `StreamingMessage` (mensaje mientras llega la respuesta).
- **`Composer.tsx`**: textarea, botón de enviar y banner de error. **Maneja Enter / Shift+Enter y el submit**; solo expone `onSend()` al padre.

### Preview (`components/preview/`)

- **`PreviewPanel.tsx`**: barra de herramientas (recargar, descargar, pantalla completa, cerrar), iframe sandbox y botón "Volver al chat". Recibe la etiqueta de estado ya calculada. Si la experiencia queda lista mientras se anima un parche, mantiene el overlay hasta que la animación termine.
- **`BuildOverlay.tsx`**: capa sobre el iframe mientras se genera, modifica, comprueba o repara. Elige texto y tono según `PreviewStatus`:
  - azul: generando o revisando;
  - violeta (`tone-patch`): "Modificando Experiencia";
  - amarillo (`tone-repair`): "Perfeccionando Experiencia".

  Los tonos son variables CSS (`--tone`, `--tone-soft`, `--tone-deep`).
- **`GhostCode.tsx`**: código fantasma del fondo. **Es dueño de su scroll y de sus timers**. Modos:
  - `stream`: sigue el final del código.
  - `scan`: un resaltado verde avanza una línea cada `GHOST_SCAN_STEP_MS`. Es solo estético y no refleja la detección real de errores.
  - `error`: las líneas que señalan los diagnósticos van en rojo; si no traen número, se marca la última línea escaneada.
  - `plain`: código quieto.

  Cuando recibe un `GhostDiff` nuevo, marca en rojo las líneas que salen, cambia al texto nuevo y marca en verde las que entran.

## Flujo de datos

1. `Composer` / `WelcomeScreen` → `onSend(texto)` → `App.sendMessage` hace `POST /api/chat` con los últimos `MAX_CONTEXT_MESSAGES` mensajes y `currentHtml` si existe.
2. La respuesta es **NDJSON**, un evento por línea: `delta` (texto parcial), `status`, `final` (texto completo), `done`, `error`.
   - `status` trae `patching` cuando el modelo responde con un parche, o `patch-fallback` cuando el parche falló y va a llegar un documento completo.
   - Con `patching`, el estado del preview pasa a `patching` (en una reparación se queda en `repairing`) y el HTML parcheado no se muestra como código fantasma en streaming. Cuando se confirma, se guarda un `GhostDiff` (antes/después) para animar el cambio. `processStream` los lee y usa `WebXrStreamParser` para separar `<webxr-html>` y `<assistant-response>`.
3. Con el HTML completo, `commitCompletedHtml` lo carga en el iframe (`iframeKey` + nuevo `previewRunId`) y arranca un timeout de arranque de `PREVIEW_STARTUP_TIMEOUT_MS`.
4. El iframe envía `postMessage` con `namespace: "profeia-preview"` y el `runId` actual. `App` los acepta solo si vienen de `iframeRef.contentWindow` y coinciden con `previewRunId`.
5. `classifyPreviewDiagnostic` decide:
   - `ready`: tras 900 ms sin fatales, el preview pasa a `ready` y el mensaje se hace visible con sus correcciones.
   - `fatal`: se reintenta con un mensaje interno (`internal: true`, `isRepair: true`) hasta `MAX_REPAIR_ATTEMPTS`. Si se agota, el estado es `repair-failed`.
6. `visibleMessages` filtra los mensajes `internal`, que son los de reparación y el modelo mientras se valida.

## Convenciones y cuidados

- **Antes de entregar cambios**: `npm run typecheck -w client` y `npm run test -w client`. Si tocas la UI, comprueba también los escenarios de `DevAuditPanel` en `npm run dev`, que no llaman al LLM.
- **Componentes presentacionales**: reciben todo por props y no hacen `fetch`. La red vive en `App.tsx` y `useAuth`.
- **Un efecto pertenece al componente dueño del nodo del DOM al que afecta** (por eso el scroll está en `MessageList` y `BuildOverlay`, no en `App`).
- **Textos de UI en español**. Los selectores de `index.css` dependen de nombres de clase; si renombras una clase, actualiza el CSS.
- **Marcador de ejecución**: el HTML recibido contiene `__PROFEIA_PREVIEW_RUN_ID__`, que `App` reemplaza por `previewRunId` antes de pasarlo al iframe. Sin ese reemplazo los diagnósticos se descartan.
- **El iframe usa `sandbox`** (`allow-scripts allow-forms allow-pointer-lock allow-downloads`). No añadas `allow-same-origin`.
- **Cuidado con la reparación automática al probar**: si un preview no emite diagnósticos en 12 s, se dispara `startup-timeout` y se lanza una petición real a `/api/chat`. Mientras `isLoading` es `true`, `loadDevScenario` no hace nada.

## Por qué `App.tsx` sigue siendo grande

Es una decisión consciente. `processStream`, `sendMessage` y el manejo de diagnósticos se llaman entre sí y comparten 14 refs y casi todo el estado. Moverlos a un hook (`useWebXrSession`) solo trasladaría ~400 líneas a otro archivo sin separar responsabilidades. No lo hagas salvo que también se rompa en piezas independientes (lectura NDJSON, etiqueta de estado, cargador de escenarios dev).

## Dónde añadir cosas

| Quiero… | Lo pongo en… |
|---|---|
| Un tipo usado en varios archivos | `types.ts` |
| Un límite o texto fijo | `constants.ts` |
| Un nuevo estado visual del chat | Componente en `components/chat/`, con datos por props desde `App` |
| Algo del panel de preview | `components/preview/` |
| Un nuevo tipo de diagnóstico | `previewDiagnostics.ts` (+ test) y `PreviewDiagnosticType` |
| Un nuevo escenario de auditoría | `dev/devScenarios.ts` (`previousHtml` anima un diff, `diagnostic` simula un error del iframe) |
| Lógica pura (parseo, clasificación) | Archivo en `src/` con test en `test/` |
