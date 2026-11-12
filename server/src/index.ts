import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, parseApiTokens, type ApiToken } from "./app.js";
import { createProviderRegistry, type ProviderRegistry } from "./llm/index.js";
import { createGenerator } from "./orchestrator.js";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDirectory, "../../.env") });

const accessPassword = process.env.ACCESS_PASSWORD;
const rawLogDir = process.env.LLM_RAW_DEBUG === "true" ? path.resolve(serverDirectory, "../../.experiments") : undefined;
const port = Number(process.env.PORT) || 3000;

if (!accessPassword) {
  console.error("Falta ACCESS_PASSWORD en el archivo .env de la raíz.");
  process.exit(1);
}

let registry: ProviderRegistry;
let apiTokens: ApiToken[];
try {
  registry = createProviderRegistry(process.env);
  apiTokens = parseApiTokens(process.env.API_TOKENS);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const corsOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
const clientDist = path.resolve(serverDirectory, "../../client/dist");
const app = createApp({
  generateReply: createGenerator(registry.get, { rawLogDir }),
  providers: registry.providers.map(({ id, label, model }) => ({ id, label, model })),
  defaultProvider: registry.defaultId,
  accessPassword,
  apiTokens,
  corsOrigins,
  clientDist,
});

app.listen(port, () => {
  const providers = registry.providers.map((provider) => `${provider.id} (${provider.model})`).join(", ");
  console.log(`Servidor listo en http://localhost:${port} | proveedores: ${providers} | predeterminado: ${registry.defaultId} | clientes API: ${apiTokens.length}`);
});
