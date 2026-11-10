import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, MAX_SEARCH_ROUNDS, type AgentEvent } from "../src/agent.ts";
import type { ChatMessage, CompleteOptions, Completion, Llm } from "../src/llm.ts";
import type { SearchArgs, SearchFn } from "../src/search.ts";
import { Store } from "../src/store.ts";

const TZ = "Asia/Kolkata";
const call = (id: string, args: object) => ({ id, name: "web_search", arguments: JSON.stringify(args) });

function setup(script: Completion[], search: SearchFn, now = "2026-11-10T14:15:00Z") {
  const requests: CompleteOptions[] = [];
  const llm: Llm = async (o) => {
    requests.push({ ...o, messages: [...o.messages] });
    const next = script.shift() ?? { text: "done", toolCalls: [] };
    if (next.text) o.onText(next.text);
    return next;
  };
  const store = new Store(mkdtempSync(join(tmpdir(), "agent-")));
  const clock = { t: new Date(now) };
  const agent = new Agent({ llm, search, store, clock: () => clock.t, tz: TZ });
  return { agent, store, requests, clock };
}

test("parallel tool calls run concurrently and results reach the model", async () => {
  const started: string[] = [];
  const finished: string[] = [];
  const search: SearchFn = async (a: SearchArgs) => {
    started.push(a.query);
    await new Promise((r) => setTimeout(r, 20));
    finished.push(a.query);
    return { hits: [{ title: a.query, url: `https://${a.query}.com`, snippet: "s", published: null }] };
  };
  const { agent, store, requests } = setup(
    [
      { text: "", toolCalls: [call("1", { query: "hubspot" }), call("2", { query: "pipedrive", since: "2026-11-03" })] },
      { text: "Both changed.", toolCalls: [] },
    ],
    search,
  );
  const events: AgentEvent[] = [];
  const answer = await agent.turn("t", "any changes?", (e) => events.push(e));

  assert.deepEqual(started, ["hubspot", "pipedrive"]);
  assert.equal(started.length, 2);
  assert.equal(finished.length, 2);
  assert.equal(answer, "Both changed.");
  assert.deepEqual(events.filter((e) => e.type === "search").map((e) => (e as any).query), ["hubspot", "pipedrive"]);

  const second = requests[1].messages;
  assert.equal(second.filter((m) => m.role === "tool").length, 2);
  assert.match(String((second.find((m) => m.role === "tool") as any).content), /https:\/\/hubspot\.com/);

  const saved = store.load("t");
  assert.equal(saved.length, 2);
  assert.deepEqual(saved[1].searches?.map((s) => s.query), ["hubspot", "pipedrive"]);
  assert.equal(saved[1].searches?.[1].since, "2026-11-03");
});

test("concurrency: both searches start before either finishes", async () => {
  let inFlight = 0;
  let peak = 0;
  const search: SearchFn = async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    return { hits: [] };
  };
  const { agent } = setup([{ text: "", toolCalls: [call("1", { query: "a" }), call("2", { query: "b" })] }, { text: "ok", toolCalls: [] }], search);
  await agent.turn("t", "q", () => {});
  assert.equal(peak, 2);
});

test("after the search budget the model is forced to answer", async () => {
  const search: SearchFn = async () => ({ hits: [] });
  const looping = Array.from({ length: 5 }, (_, i) => ({ text: "", toolCalls: [call(String(i), { query: `q${i}` })] }));
  const { agent, requests } = setup([...looping.slice(0, MAX_SEARCH_ROUNDS), { text: "final", toolCalls: [call("x", { query: "ignored" })] }], search);
  const answer = await agent.turn("t", "q", () => {});
  assert.equal(requests.length, MAX_SEARCH_ROUNDS + 1);
  assert.equal(requests.at(-1)!.toolChoice, "none");
  assert.equal(requests[0].toolChoice, "auto");
  assert.equal(answer, "final");
});

test("history from earlier days is stamped, so recall works from the prompt alone", async () => {
  const { agent, requests, clock } = setup([{ text: "You asked about Postgres hosting.", toolCalls: [] }, { text: "ok", toolCalls: [] }], async () => ({ hits: [] }), "2026-11-03T05:00:00Z");
  await agent.turn("t", "Which Postgres host should we use?", () => {});
  clock.t = new Date("2026-11-10T14:15:00Z");
  await agent.turn("t", "What did I ask you on 3 November?", () => {});

  const msgs = requests[1].messages as ChatMessage[];
  assert.equal(msgs[0].role, "system");
  assert.match(String(msgs[0].content), /2026-11-03 Tue 3 Nov 2026 {2}<- last Tue/);
  assert.match(String(msgs[1].content), /^\[Tue 3 Nov 2026 10:30\] Which Postgres host/);
  assert.match(String(msgs.at(-1)!.content), /^\[Tue 10 Nov 2026 19:45\] What did I ask you on 3 November\?/);
});

test("bad tool arguments come back as a tool error, not a crash", async () => {
  const { agent, requests } = setup(
    [{ text: "", toolCalls: [{ id: "1", name: "web_search", arguments: "{oops" }, { id: "2", name: "browse", arguments: "{}" }] }, { text: "ok", toolCalls: [] }],
    async () => {
      throw new Error("must not be called");
    },
  );
  await agent.turn("t", "q", () => {});
  const tools = requests[1].messages.filter((m) => m.role === "tool").map((m) => String((m as any).content));
  assert.match(tools[0], /not valid JSON/);
  assert.match(tools[1], /Unknown tool browse/);
});

test("turns on one thread are serialized", async () => {
  const order: string[] = [];
  const llm: Llm = async (o) => {
    const last = String(o.messages.at(-1)!.content);
    order.push("start " + last.slice(-1));
    await new Promise((r) => setTimeout(r, last.endsWith("1") ? 20 : 1));
    order.push("end " + last.slice(-1));
    return { text: "x", toolCalls: [] };
  };
  const agent = new Agent({ llm, search: async () => ({ hits: [] }), store: new Store(mkdtempSync(join(tmpdir(), "agent-"))), clock: () => new Date(), tz: TZ });
  await Promise.all([agent.turn("t", "m1", () => {}), agent.turn("t", "m2", () => {})]);
  assert.deepEqual(order, ["start 1", "end 1", "start 2", "end 2"]);
});

test("a failed model call surfaces the error and leaves the user turn recorded", async () => {
  const llm: Llm = async () => {
    throw new Error("LLM request failed: 401");
  };
  const store = new Store(mkdtempSync(join(tmpdir(), "agent-")));
  const agent = new Agent({ llm, search: async () => ({ hits: [] }), store, clock: () => new Date(), tz: TZ });
  await assert.rejects(agent.turn("t", "hello", () => {}), /401/);
  assert.deepEqual(store.load("t").map((t) => t.role), ["user"]);
  // The lock must not stay poisoned.
  await assert.rejects(agent.turn("t", "again", () => {}), /401/);
});
