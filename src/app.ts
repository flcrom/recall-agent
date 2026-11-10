import { Agent } from "./agent.ts";
import { systemClock } from "./clock.ts";
import { assertRunnable, readConfig } from "./config.ts";
import { openAiCompatible } from "./llm.ts";
import { cached, tavilySearch } from "./search.ts";
import { Store } from "./store.ts";

export function createAgent(env = process.env) {
  const config = readConfig(env);
  try {
    assertRunnable(config);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
  const agent = new Agent({
    llm: openAiCompatible({ baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel }),
    search: cached(tavilySearch(config.tavilyKey)),
    store: new Store(config.dataDir),
    clock: systemClock,
    tz: config.tz,
  });
  return { agent, config };
}
