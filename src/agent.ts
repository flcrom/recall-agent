import { isoDay, stamp, type Clock } from "./clock.ts";
import { buildHistory } from "./history.ts";
import type { ChatMessage, Llm, ToolSpec } from "./llm.ts";
import { systemPrompt } from "./prompt.ts";
import { renderOutcome, type SearchArgs, type SearchFn } from "./search.ts";
import type { SearchRecord, Store } from "./store.ts";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "search"; query: string; since?: string }
  | { type: "done" };

const SEARCH_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web. Call it several times in parallel for several subjects. Use since (YYYY-MM-DD) only to find pages published on or after a day; it drops undated pages such as pricing pages. Use topic news for recent events, site to target an official domain.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        since: { type: "string", description: "YYYY-MM-DD" },
        topic: { type: "string", enum: ["general", "news"] },
        site: { type: "string", description: "Domain such as hubspot.com" },
      },
      required: ["query"],
    },
  },
};

/** Search rounds per turn. After this the model must answer. */
export const MAX_SEARCH_ROUNDS = 2;

export interface AgentDeps {
  llm: Llm;
  search: SearchFn;
  store: Store;
  clock: Clock;
  tz: string;
  historyBudgetChars?: number;
}

export class Agent {
  private locks = new Map<string, Promise<unknown>>();

  constructor(private deps: AgentDeps) {}

  /** Turns on one thread run one at a time so history stays in order. */
  turn(thread: string, userText: string, emit: (e: AgentEvent) => void): Promise<string> {
    const prev = this.locks.get(thread) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.run(thread, userText, emit));
    this.locks.set(thread, run);
    return run;
  }

  private async run(thread: string, userText: string, emit: (e: AgentEvent) => void): Promise<string> {
    const { llm, search, store, clock, tz } = this.deps;
    const now = clock();
    const history = buildHistory(store.load(thread), tz, this.deps.historyBudgetChars);
    store.append(thread, { ts: now.toISOString(), role: "user", content: userText });

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(now, tz) },
      ...history,
      { role: "user", content: `[${stamp(now, tz)}] ${userText}` },
    ];
    const records: SearchRecord[] = [];
    let answer = "";

    for (let round = 0; ; round++) {
      const last = round >= MAX_SEARCH_ROUNDS;
      const out = await llm({
        messages,
        tools: [SEARCH_TOOL],
        toolChoice: last ? "none" : "auto",
        onText: (text) => emit({ type: "text", text }),
      });
      if (!out.toolCalls.length || last) {
        answer += out.text;
        break;
      }
      // Text streamed before a tool call stays on screen, so keep it in the answer too.
      answer += out.text ? out.text.trimEnd() + "\n\n" : "";
      messages.push({
        role: "assistant",
        content: out.text || null,
        tool_calls: out.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
      });
      const results = await Promise.all(
        out.toolCalls.map(async (call) => {
          const parsed = parseArgs(call.name, call.arguments);
          if (typeof parsed === "string") return { call, content: parsed };
          emit({ type: "search", query: parsed.query, since: parsed.since });
          const at = clock();
          const outcome = await search(parsed);
          records.push({ query: parsed.query, since: parsed.since, at: at.toISOString(), urls: outcome.hits.map((h) => h.url) });
          return { call, content: renderOutcome(outcome, isoDay(at, tz)) };
        }),
      );
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.call.id, content: r.content });
    }

    answer = answer.trim() || "I could not produce an answer. Please try again.";
    store.append(thread, { ts: clock().toISOString(), role: "assistant", content: answer, searches: records.length ? records : undefined });
    emit({ type: "done" });
    return answer;
  }
}

function parseArgs(name: string, raw: string): SearchArgs | string {
  if (name !== "web_search") return `Unknown tool ${name}. Only web_search exists.`;
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(raw || "{}");
  } catch {
    return "Arguments were not valid JSON. Call web_search again with a query.";
  }
  if (typeof a.query !== "string" || !a.query.trim()) return "web_search needs a non-empty query.";
  return {
    query: a.query.trim(),
    since: typeof a.since === "string" ? a.since : undefined,
    topic: a.topic === "news" ? "news" : "general",
    site: typeof a.site === "string" && a.site ? a.site : undefined,
  };
}
