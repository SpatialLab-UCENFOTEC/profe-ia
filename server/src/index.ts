import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createGeminiGenerator, THINKING_LEVELS, type ThinkingLevelName } from "./gemini.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, "../../.env") });

const apiKey = process.env.GEMINI_API_KEY;
const accessPassword = process.env.ACCESS_PASSWORD;
const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const port = Number(process.env.PORT) || 3000;
// Railway sobrescribe X-Real-IP con la IP del cliente en cada request; su cantidad de saltos de
// proxy no es fija, así que `trust proxy` de Express no sirve ahí.
const clientIpHeader = process.env.CLIENT_IP_HEADER ?? (process.env.RAILWAY_ENVIRONMENT_NAME ? "x-real-ip" : undefined);

function positiveInteger(name: string) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    console.error(`${name} debe ser un entero mayor que 0 (valor actual: ${raw}).`);
    process.exit(1);
  }
  return value;
}

// Nivel de razonamiento de Gemini (minimal, low, medium, high, o "default" para el del modelo).
// Sin valor, low en Gemini 3: medido con gemini-3.6-flash, crear baja de 26-31 s a 7-9 s y un
// cambio chico de 3 s a 2 s, con escenas equivalentes. Los modelos 2.x no aceptan thinkingLevel.
const thinkingSetting = process.env.GEMINI_THINKING_LEVEL?.trim().toLowerCase()
  || (model.startsWith("gemini-3") ? "low" : "default");
if (thinkingSetting !== "default" && !(THINKING_LEVELS as readonly string[]).includes(thinkingSetting)) {
  console.error(`GEMINI_THINKING_LEVEL debe ser uno de: ${THINKING_LEVELS.join(", ")}, default (valor actual: ${thinkingSetting}).`);
  process.exit(1);
}
const thinkingLevel = thinkingSetting === "default" ? undefined : thinkingSetting;

const chatRequestsPerSession = positiveInteger("CHAT_REQUESTS_PER_SESSION");
const chatRequestsPerHour = positiveInteger("CHAT_REQUESTS_PER_HOUR");

if (!apiKey) {
  console.error("Falta GEMINI_API_KEY en el archivo .env de la raíz.");
  process.exit(1);
}

if (!accessPassword) {
  console.error("Falta ACCESS_PASSWORD en el archivo .env de la raíz.");
  process.exit(1);
}

const clientDist = path.resolve(serverDirectory, "../../client/dist");
const app = createApp({
  generateReply: createGeminiGenerator(apiKey, model, thinkingLevel as ThinkingLevelName | undefined),
  model,
  accessPassword,
  clientDist,
  clientIpHeader,
  chatRequestsPerSession,
  chatRequestsPerHour,
});

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port} (modelo: ${model}${thinkingLevel ? `, razonamiento: ${thinkingLevel}` : ""})`);
});
