# Orbit XR

Asistente full-stack que genera experiencias WebXR completas con Gemini, muestra el HTML en un iframe mientras se produce y permite conversar sobre cada versión, verla a pantalla completa y descargarla.

## Funciones

- Generación rápida de escenas A-Frame a partir de una descripción compacta: el servidor ensambla un HTML completo con controles de escritorio y XR, interfaz e interacciones comunes.
- Generación HTML libre con A-Frame, Three.js o ambos cuando la experiencia necesita lógica que no cubre el motor de escenas.
- Respuesta NDJSON incremental; el HTML libre se muestra mientras se genera y la escena compacta se ensambla al terminar su descripción.
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

   Opcionales, para acotar el uso de Gemini: `CHAT_REQUESTS_PER_SESSION` (solicitudes por sesión cada 15 minutos, 30 por defecto) y `CHAT_REQUESTS_PER_HOUR` (techo por hora sumando todas las sesiones, 300 por defecto). Cada solicitud puede hacer más de una llamada al modelo (resumen faltante o fallback a HTML libre) y cada reparación automática cuenta como una solicitud más.

   En Railway el servidor toma la IP del cliente del header `X-Real-IP`, que pone el proxy de Railway, para contar los intentos de login por persona y no por proxy. Fuera de Railway se usa la IP del socket; si hay otro proxy delante, define `CLIENT_IP_HEADER` con el header que traiga la IP real.
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
- `POST /api/chat`: responde `429` con `Retry-After` al superar el límite por sesión o el techo por hora. Recibe `{ "messages": [...], "currentHtml": "..." }` y transmite líneas NDJSON con eventos `delta`, `doc` (borrador de la base para la vista en vivo), `final`, `done` o `error`.
- `GET /api/chat/base`: requiere sesión; devuelve la escena vacía de la base, que el cliente monta desde el primer borrador.

El cliente conserva únicamente resúmenes en el historial enviado al modelo y adjunta por separado la última versión HTML terminada. No se utiliza base de datos ni almacenamiento persistente del navegador.

## Base en vivo

Toda experiencia parte de una base fija (`server/runtime/profeia-base.js` y `.css`): un HTML con A-Frame que contiene el runtime y un documento JSON con entorno, entidades 3D, interfaz, estilos, acciones y scripts (`server/src/base/schema.ts`). La primera solicitud parte de la escena vacía.

El modelo no reescribe el HTML: responde con operaciones en `<webxr-ops>`, una por línea (`reset`, `meta`, `env`, `set`, `merge`, `remove`). Mientras llegan, el servidor las aplica a un borrador y emite eventos `doc`; el cliente los manda al iframe por `postMessage` y la escena se ve crecer sin recargar. Al cerrar el bloque, el servidor aplica todas las operaciones de forma atómica, valida el documento y entrega el HTML final de la base en `<webxr-html>`, que sigue sirviendo para la descarga y como contexto de la próxima solicitud.

Los cambios de color, posición, texto, estilos y entorno se aplican sobre los mismos elementos y conservan el estado de la interacción. Agregar o quitar elementos con scripts reconstruye la escena dentro del mismo iframe. Si las operaciones no se pueden aplicar, el servidor pide una corrección una vez con el motivo; si vuelve a fallar, la experiencia anterior queda igual y el chat lo avisa. Las correcciones automáticas por errores de ejecución recargan el iframe desde cero.

Cuando la solicitud requiere otro motor (por ejemplo Three.js puro), el modelo puede devolver HTML completo en `<webxr-html>`, que pasa sin cambios y se carga como antes.
