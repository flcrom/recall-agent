import { existsSync, readFileSync } from "node:fs";

// Tiny .env loader so the project runs on any Node >= 20 without flags.
export function loadDotenv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined || process.env[m[1]] === "") process.env[m[1]] = value;
  }
}

export interface Config {
  port: number;
  tz: string;
  dataDir: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  tavilyKey: string;
}

export function readConfig(env = process.env): Config {
  return {
    port: Number(env.PORT) || 3000,
    tz: env.AGENT_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    dataDir: env.DATA_DIR || "./data",
    llmBaseUrl: (env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    llmApiKey: env.LLM_API_KEY || "",
    llmModel: env.LLM_MODEL || "gpt-4.1-mini",
    tavilyKey: env.TAVILY_API_KEY || "",
  };
}

export function assertRunnable(c: Config): void {
  const missing: string[] = [];
  if (!c.tavilyKey) missing.push("TAVILY_API_KEY");
  // Local servers such as Ollama need no key; every hosted provider does.
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(c.llmBaseUrl);
  if (!c.llmApiKey && !local) missing.push("LLM_API_KEY");
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}. Copy .env.example to .env and fill it in.`);
  }
}
