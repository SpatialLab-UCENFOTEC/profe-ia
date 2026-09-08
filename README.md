# Chatbot con Gemini

Chatbot full-stack con un backend Node.js/Express y un frontend React + TypeScript diseñado con DaisyUI. La clave de Gemini permanece únicamente en el servidor.

## Requisitos

- Node.js 20.19 o superior
- Una API key de [Google AI Studio](https://aistudio.google.com/app/apikey)

## Configuración

1. Instala las dependencias:

   ```bash
   npm install
   ```

2. Crea `.env` en la raíz (puedes copiar `.env.example`):

   ```env
   GEMINI_API_KEY=tu_api_key
   GEMINI_MODEL=gemini-3.6-flash
   PORT=3000
   ```

3. Inicia frontend y backend en modo desarrollo:

   ```bash
   npm run dev
   ```

   Abre `http://localhost:5173`. Vite redirige `/api` al backend en `http://localhost:3000`.

## Producción

```bash
npm run build
npm start
```

El servidor entrega la aplicación compilada en `http://localhost:3000`.

## Comandos

- `npm run dev`: inicia ambos proyectos con recarga automática.
- `npm run build`: comprueba tipos y compila cliente y servidor.
- `npm test`: ejecuta pruebas del API y typecheck del cliente.
- `npm start`: sirve el build de producción.

## API

- `GET /api/health`: estado y modelo configurado.
- `POST /api/chat`: recibe `{ "messages": [{ "role": "user", "content": "Hola" }] }`.
