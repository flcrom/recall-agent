import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAgent } from "./app.ts";
import { loadDotenv } from "./config.ts";
import { Store } from "./store.ts";

loadDotenv();
const { agent, config } = createAgent();
const store = new Store(config.dataDir);
const page = readFileSync(fileURLToPath(new URL("../public/index.html", import.meta.url)));

async function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    } else if (req.method === "GET" && url.pathname === "/api/history") {
      const turns = store.load(url.searchParams.get("thread") || "default");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(turns));
    } else if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "message is required" }));
        return;
      }
      const thread = typeof body.thread === "string" && body.thread ? body.thread : "default";
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const send = (event: object) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      try {
        await agent.turn(thread, message, send);
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      }
      res.end();
    } else {
      res.writeHead(404).end("not found");
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}).listen(config.port, () => console.log(`http://localhost:${config.port}`));
