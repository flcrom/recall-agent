import { createInterface } from "node:readline/promises";
import { createAgent } from "./app.ts";
import { loadDotenv } from "./config.ts";

loadDotenv();
const { agent } = createAgent();
const thread = process.argv[2] || "default";
const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  const line = (await rl.question("> ").catch(() => "")).trim();
  if (!line) break;
  await agent.turn(thread, line, (e) => {
    if (e.type === "text") process.stdout.write(e.text);
    if (e.type === "search") process.stderr.write(`\n[searching: ${e.query}${e.since ? ` since ${e.since}` : ""}]\n`);
  });
  process.stdout.write("\n");
}
rl.close();
