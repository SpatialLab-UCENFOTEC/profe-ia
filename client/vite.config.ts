import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // El servidor lee PORT del .env de la raíz; el proxy debe apuntar al mismo puerto.
  const env = loadEnv(mode, fileURLToPath(new URL("..", import.meta.url)), "");
  const apiPort = Number(env.PORT) || 3000;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
  };
});
