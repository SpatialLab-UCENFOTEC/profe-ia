import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createGeminiGenerator } from "./gemini.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, "../../.env") });

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const port = Number(process.env.PORT) || 3000;

if (!apiKey) {
  console.error("Falta GEMINI_API_KEY en el archivo .env de la raíz.");
  process.exit(1);
}

const clientDist = path.resolve(serverDirectory, "../../client/dist");
const app = createApp({
  generateReply: createGeminiGenerator(apiKey, model),
  model,
  clientDist,
});

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port} (modelo: ${model})`);
});
