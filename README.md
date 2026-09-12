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

## Configuración local

Copia `.env.example` como `.env` y configura `GEMINI_API_KEY` y `ACCESS_PASSWORD`. La contraseña se valida exclusivamente en el servidor y nunca se incluye en el bundle del cliente.

- Para probar sesiones XR inmersivas: navegador y dispositivo compatibles, además de HTTPS o `localhost`. El usuario debe iniciar XR mediante un gesto explícito.
- Conexión a Internet para las experiencias que carguen librerías, modelos o texturas desde CDN.

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea `.env` en la raíz, tomando `.env.example` como base:

   ```env
   GEMINI_API_KEY=tu_api_key
   GEMINI_MODEL=gemini-3.6-flash
   ACCESS_PASSWORD=una_contraseña_larga_y_segura
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

## Despliegue en Railway

El repositorio está preparado para desplegarse como **un único servicio**: Railway compila el cliente y el servidor, y Express sirve tanto la API como los archivos estáticos. La configuración en `railway.json` define Railpack, los comandos de build y arranque, el healthcheck y la política de reinicio.

### Desde GitHub

1. Sube el repositorio a GitHub y elige **New Project → Deploy from GitHub repo** en Railway.
2. Selecciona este repositorio. Mantén el directorio raíz del servicio en `/`; no crees servicios separados para `client` y `server`.
3. En **Variables**, agrega:

   ```env
   GEMINI_API_KEY=tu_api_key_real
   ACCESS_PASSWORD=una_contraseña_larga_y_segura
   GEMINI_MODEL=gemini-3.6-flash
   ```

   `GEMINI_MODEL` es opcional. No definas `PORT`: Railway lo asigna automáticamente.
4. En **Settings → Networking**, genera un dominio público. Railway volverá a desplegar automáticamente con cada push a la rama conectada.

### Desde la CLI

Con la [CLI de Railway](https://docs.railway.com/cli) instalada y autenticada, ejecuta desde la raíz:

```bash
railway init
railway variables set GEMINI_API_KEY=tu_api_key_real ACCESS_PASSWORD=una_contraseña_larga_y_segura
railway up
railway domain
```

Comprueba el despliegue en `https://TU-DOMINIO/api/health`. Debe responder con `{ "ok": true, ... }`.

> Las sesiones se guardan en memoria. Se cierran al reiniciar o volver a desplegar el servicio; para este proyecto conviene mantener una sola réplica, salvo que se añada un almacén de sesiones compartido.

## API

- `GET /api/health`: devuelve el estado y modelo configurado.
- `POST /api/chat`: recibe `{ "messages": [...], "currentHtml": "..." }` y transmite líneas NDJSON con eventos `delta`, `done` o `error`.

El cliente conserva únicamente resúmenes en el historial enviado al modelo y adjunta por separado la última versión HTML terminada. No se utiliza base de datos ni almacenamiento persistente del navegador.
