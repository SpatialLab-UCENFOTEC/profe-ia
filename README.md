# Orbit XR

Asistente full-stack que genera experiencias WebXR completas con Gemini, muestra el HTML en un iframe mientras se produce y permite conversar sobre cada versión, verla a pantalla completa y descargarla.

## Funciones

- Generación con A-Frame, Three.js o ambos según las necesidades de la experiencia.
- Respuesta incremental NDJSON y preview actualizado durante el stream.
- Documento HTML completo en un bloque plegable, seguido de una explicación Markdown.
- Preview lateral en escritorio y superpuesto en móvil, con recarga, expansión y descarga.
- Historial mantenido durante la sesión abierta; el HTML vigente se utiliza como base para cambios posteriores.
- API key de Gemini utilizada únicamente por el servidor.
- Acceso protegido por contraseña con sesión segura en cookie `HttpOnly`.

## Requisitos

- Node.js 20.19 o superior.
- Una API key de [Google AI Studio](https://aistudio.google.com/app/apikey).

## Configuración

Copia `.env.example` como `.env` y configura `GEMINI_API_KEY` y `ACCESS_PASSWORD`. La contraseña se valida exclusivamente en el servidor y nunca se incluye en el bundle del cliente.
- Para probar sesiones XR inmersivas: navegador y dispositivo compatibles, además de HTTPS o `localhost`. El usuario debe iniciar XR mediante un gesto explícito.
- Conexión a Internet para las experiencias que carguen librerías, modelos o texturas desde CDN.

## Configuración

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea `.env` en la raíz, tomando `.env.example` como base:

   ```env
   GEMINI_API_KEY=tu_api_key
   GEMINI_MODEL=gemini-3.6-flash
   PORT=3000
   ```

3. Inicia frontend y backend:

   ```bash
   npm run dev
   ```

   Abre `http://localhost:5173`. Vite redirige `/api` al backend en `http://localhost:3000`.

## Producción y comprobaciones

```bash
npm test
npm run build
npm start
```

El servidor de producción entrega la aplicación compilada en `http://localhost:3000`.

## API

- `GET /api/health`: devuelve el estado y modelo configurado.
- `POST /api/chat`: recibe `{ "messages": [...], "currentHtml": "..." }` y transmite líneas NDJSON con eventos `delta`, `done` o `error`.

El cliente conserva únicamente resúmenes en el historial enviado al modelo y adjunta por separado la última versión HTML terminada. No se utiliza base de datos ni almacenamiento persistente del navegador.
