import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRunnable, readConfig } from "../src/config.ts";

test("missing keys are named for any hosted provider", () => {
  const c = readConfig({ LLM_BASE_URL: "https://openrouter.ai/api/v1" });
  assert.throws(() => assertRunnable(c), /Missing TAVILY_API_KEY, LLM_API_KEY/);
});

test("a local model server needs no LLM key", () => {
  const c = readConfig({ LLM_BASE_URL: "http://localhost:11434/v1", TAVILY_API_KEY: "x" });
  assert.doesNotThrow(() => assertRunnable(c));
});
