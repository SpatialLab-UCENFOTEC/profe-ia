# API de Orbit XR

Orbit XR expone por HTTP el mismo motor que usa el frontend: recibe una conversación y devuelve una experiencia WebXR (un documento HTML completo) junto con una explicación en Markdown. Cualquier cliente puede usarlo (otra aplicación web, un script, Unity, un bot) si tiene un **token de API**.

- URL base local: `http://localhost:3000`
- URL base en producción: `https://TU-DOMINIO`
- Formato de las peticiones: JSON (`Content-Type: application/json`), hasta 512 KB por cuerpo.

## Autenticación

Todas las llamadas a `/api/chat` requieren un token Bearer:

```http
Authorization: Bearer <token>
```

El frontend web no usa tokens: entra con la contraseña (`ACCESS_PASSWORD`) y una cookie de sesión. Las dos vías conviven.

### Crear un token

1. Genera un valor aleatorio de al menos 32 caracteres:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. Añádelo a `API_TOKENS` en el `.env` de la raíz (o en las variables de Railway) con un nombre que identifique al cliente. Si hay varios, sepáralos con comas:

   ```env
   API_TOKENS=unity-lab:Xb3k...,bot-clase:9fQa...
   ```

   El nombre solo puede contener letras, números, `_`, `-` y `.`; aparece en los logs del servidor para saber quién hizo cada petición.

3. Reinicia el servidor. Al arrancar, el mensaje `clientes API: N` indica cuántos tokens cargó. Si alguno es inválido (formato, longitud, nombre repetido), el servidor no arranca y explica el motivo.

### Revocar o rotar

Quita o cambia la entrada en `API_TOKENS` y reinicia. El servidor solo conserva un hash SHA-256 de cada token y los compara en tiempo constante.

### Errores de autenticación

| Código | Cuándo | Cuerpo |
|---|---|---|
| `401` | Falta el token y no hay sesión, o el token no existe. Incluye `WWW-Authenticate: Bearer`. | `{ "error": "..." }` |
| `429` | Más de 10 tokens inválidos desde la misma IP en 15 minutos. La cabecera `Retry-After` indica los segundos de espera. | `{ "error": "..." }` |

## Endpoints

### `GET /api/health`

No requiere autenticación.

```json
{ "ok": true, "defaultProvider": "claude-cli", "providers": ["claude-cli", "gemini"] }
```

### `GET /api/providers`

Requiere autenticación. Lista los modelos de lenguaje activos y cuál se usa por defecto. El `id` es el valor que se envía en el campo `provider` de `/api/chat`.

```json
{
  "default": "claude-cli",
  "providers": [
    { "id": "claude-cli", "label": "Claude haiku (CLI local)", "model": "haiku" },
    { "id": "gemini", "label": "Gemini gemini-3.7-flash", "model": "gemini-3.7-flash" }
  ]
}
```

### `POST /api/chat`

Genera o modifica una experiencia.

#### Cuerpo

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `messages` | `{ role, content }[]` | Sí | Historial de 1 a 30 mensajes. `role` es `"user"` o `"assistant"` (`"model"` se acepta como alias). `content` no puede estar vacío ni superar 8000 caracteres. El último mensaje debe ser del usuario. |
| `currentHtml` | `string` | No | Documento HTML vigente (hasta 250 000 caracteres). Si se envía, el modelo lo toma como base y puede responder con un parche en lugar de regenerarlo todo. |
| `provider` | `string` | No | `id` del modelo de lenguaje que debe responder (ver `GET /api/providers`). Si se omite, se usa el predeterminado. Un id desconocido devuelve `400`. |

Para conversar sobre una experiencia ya creada, envía en `messages` solo los textos de las respuestas anteriores (el contenido de `<assistant-response>`) y el último HTML en `currentHtml`, igual que hace el frontend. Así el historial no repite documentos completos.

#### Parámetro de consulta `stream`

- Sin parámetro (por defecto): respuesta incremental en NDJSON.
- `?stream=false`: espera a que termine y devuelve un único JSON.

#### Respuesta JSON (`?stream=false`)

```json
{
  "response": "Creé un cubo rojo que gira al hacer clic...",
  "html": "<!doctype html>...",
  "raw": "<webxr-html>...</webxr-html><assistant-response>...</assistant-response>",
  "provider": "claude-cli"
}
```

- `response`: explicación en Markdown.
- `html`: documento completo, listo para guardar como `.html` o cargar en un `iframe` (`srcdoc`). Es `null` cuando la pregunta era solo conversacional y no cambió la experiencia.
- `raw`: respuesta completa con etiquetas, por si se quiere procesar como el frontend.
- `provider`: id del modelo de lenguaje que respondió.

El HTML incluye un pequeño script (`profeia-preview-monitor`) que informa errores de consola al documento padre mediante `postMessage`. Puede ignorarse o eliminarse.

#### Respuesta incremental (por defecto)

`Content-Type: application/x-ndjson`. Cada línea es un objeto JSON con `type`:

| `type` | Campos | Significado |
|---|---|---|
| `delta` | `text` | Fragmento de texto del modelo, en orden. Sirve para mostrar el progreso. |
| `status` | `phase` | `"patching"`: el modelo está escribiendo un parche sobre `currentHtml`. `"patch-fallback"`: el parche no se pudo aplicar y se está generando el documento completo. |
| `final` | `text`, `provider` | Respuesta definitiva con `<webxr-html>` (ya con escena compilada o parche aplicado) y `<assistant-response>`. **Usa este texto, no la concatenación de los `delta`.** |
| `done` | — | Fin correcto del stream. |
| `error` | `message` | La generación falló después de empezar el stream. Descarta lo recibido. |

Si el modelo falla antes de enviar el primer fragmento, la respuesta es un `502` con `{ "error": "..." }` en lugar de un stream.

#### Errores

| Código | Motivo |
|---|---|
| `400` | Cuerpo inválido (historial vacío, más de 30 mensajes, rol desconocido, último mensaje no es del usuario, textos demasiado largos, `currentHtml` no es texto o `provider` no existe). |
| `401` / `429` | Ver [Autenticación](#errores-de-autenticación). |
| `502` | El modelo de lenguaje no respondió o devolvió una respuesta vacía. |

Una generación puede tardar desde unos segundos hasta un par de minutos. Configura el tiempo de espera del cliente en consecuencia.

## Ejemplos

### curl, respuesta única

```bash
curl -s http://localhost:3000/api/chat?stream=false \
  -H "Authorization: Bearer $ORBIT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"gemini","messages":[{"role":"user","content":"Crea una escena con un cubo rojo que gire al hacer clic"}]}'
```

### curl, streaming

```bash
curl -N http://localhost:3000/api/chat \
  -H "Authorization: Bearer $ORBIT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Crea un sistema solar con tres planetas"}]}'
```

### JavaScript (Node 20+ o navegador)

```js
const BASE = "http://localhost:3000";
const TOKEN = process.env.ORBIT_TOKEN;

async function generate(messages, currentHtml) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages, currentHtml }),
  });
  if (!res.ok) throw new Error((await res.json()).error);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let final;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === "delta") process.stdout.write(".");
      if (event.type === "final") final = event.text;
      if (event.type === "error") throw new Error(event.message);
    }
  }
  const html = final.match(/<webxr-html>([\s\S]*?)<\/webxr-html>/)?.[1].trim();
  const response = final.match(/<assistant-response>([\s\S]*?)<\/assistant-response>/)?.[1].trim();
  return { html, response };
}

const first = await generate([{ role: "user", content: "Crea una galería con tres cuadros" }]);
const second = await generate(
  [
    { role: "user", content: "Crea una galería con tres cuadros" },
    { role: "assistant", content: first.response },
    { role: "user", content: "Agrega un cuarto cuadro azul" },
  ],
  first.html,
);
```

### Desde el navegador de otro dominio (CORS)

Por defecto el servidor no envía cabeceras CORS. Para permitir que una página de otro origen llame a la API, lista ese origen en `CORS_ORIGINS`:

```env
CORS_ORIGINS=https://mi-app.example.com,http://localhost:5174
```

No incluyas el token en código público del navegador: cualquiera podría leerlo. Si el cliente es una página web pública, haz las llamadas desde su propio backend.

## Modelos de lenguaje

El servidor puede tener **varios modelos de lenguaje conectados a la vez**. Cada petición elige uno con el campo `provider`; si no lo indica, responde el predeterminado. El frontend muestra un selector en la barra superior cuando hay más de uno activo y recuerda la elección en el navegador.

### Configuración

| Variable | Por defecto | Descripción |
|---|---|---|
| `LLM_PROVIDERS` | el primer adaptador registrado (`claude-cli`) | Ids de los adaptadores activos, separados por comas. Ej.: `claude-cli,gemini`. |
| `LLM_DEFAULT_PROVIDER` | el primero de `LLM_PROVIDERS` | Adaptador que responde cuando la petición no indica `provider`. |

Cada adaptador lee sus propias variables. Si un adaptador activo no tiene lo que necesita (por ejemplo, su clave), el servidor no arranca y dice qué falta.

### Adaptadores incluidos

| Id | Qué usa | Variables | Notas |
|---|---|---|---|
| `claude-cli` | La CLI de Claude Code (`claude -p`) con la sesión iniciada en la máquina del servidor. | `CLAUDE_CLI_MODEL` (por defecto `haiku`; también `sonnet`, `opus` o un ID completo), `CLAUDE_CLI_PATH`, `CLAUDE_CLI_MAX_OUTPUT_TOKENS` (64000). | No necesita clave de API. Solo sirve en local: **no funciona en Railway**. Se ejecuta sin herramientas, sin MCP, sin configuración del proyecto y fuera del repositorio. |
| `gemini` | La API de Google AI Studio con el SDK `@google/genai`. | `GEMINI_API_KEY` (obligatoria), `GEMINI_MODEL` (por defecto `gemini-3.6-flash`). | Funciona en cualquier servidor con acceso a Internet. |

### Añadir otro modelo

El servidor habla con los modelos a través de un único contrato, `LlmProvider` (`server/src/llm/types.ts`):

```ts
interface LlmProvider {
  id: string;      // valor de LLM_PROVIDERS y del campo `provider`
  label: string;   // nombre que ve el usuario
  model: string;
  streamText(request: { system: string; messages: { role: "user" | "assistant"; content: string }[]; signal?: AbortSignal }): AsyncIterable<string>;
}
```

El adaptador solo traduce mensajes a texto en streaming. El prompt, la compilación de escenas, los parches y los respaldos viven en `server/src/prompt.ts` y `server/src/orchestrator.ts`, y no cambian. Solo la carpeta `server/src/llm/` conoce los proveedores concretos.

1. Crea `server/src/llm/<proveedor>.ts` que exporte un `ProviderDefinition` (`{ id, create(env) }`). `create` lee sus variables de entorno y lanza un error claro si falta alguna. Usa `gemini.ts` o `claudeCli.ts` como ejemplo.
2. Añádelo a `PROVIDER_DEFINITIONS` en `server/src/llm/index.ts`.
3. Añade su SDK a `server/package.json` y sus variables a `.env.example`.
4. Actívalo incluyendo su id en `LLM_PROVIDERS`.
