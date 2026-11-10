import test from "node:test";
import assert from "node:assert/strict";
import { cached, renderOutcome, tavilySearch, type SearchFn } from "../src/search.ts";

function fakeFetch(responses: Array<{ status: number; json?: unknown } | Error>) {
  const calls: Array<{ url: string; body: any; auth: string | null }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("tavily request carries since, site and published dates", async () => {
  const { f, calls } = fakeFetch([
    { status: 200, json: { results: [{ title: "Pricing", url: "https://x.com/p", content: "Pro $20", published_date: "2026-11-05" }] } },
  ]);
  const out = await tavilySearch("key", f)({ query: "x pricing", since: "2026-11-03", site: "https://x.com/pricing" });
  assert.equal(calls[0].auth, "Bearer key");
  assert.equal(calls[0].body.start_date, "2026-11-03");
  assert.deepEqual(calls[0].body.include_domains, ["x.com"]);
  assert.equal(calls[0].body.include_published_date, true);
  assert.deepEqual(out.hits[0], { title: "Pricing", url: "https://x.com/p", snippet: "Pro $20", published: "2026-11-05" });
});

test("a malformed since is ignored rather than sent", async () => {
  const { f, calls } = fakeFetch([{ status: 200, json: { results: [] } }]);
  await tavilySearch("k", f)({ query: "q", since: "last week" });
  assert.equal("start_date" in calls[0].body, false);
});

test("retries once on 5xx, then reports the error instead of throwing", async () => {
  const { f, calls } = fakeFetch([{ status: 503 }, { status: 503 }]);
  const out = await tavilySearch("k", f)({ query: "q" });
  assert.equal(calls.length, 2);
  assert.match(out.error!, /503/);
  assert.match(renderOutcome(out, "2026-11-10"), /Search failed/);
});

test("cache shares in-flight and finished searches, but not errors", async () => {
  let n = 0;
  const inner: SearchFn = async () => {
    n++;
    await new Promise((r) => setTimeout(r, 5));
    return { hits: [] };
  };
  const s = cached(inner);
  await Promise.all([s({ query: "Pricing" }), s({ query: " pricing " })]);
  await s({ query: "pricing" });
  assert.equal(n, 1);
  await s({ query: "pricing", since: "2026-11-01" });
  assert.equal(n, 2);

  let fails = 0;
  const flaky = cached(async () => (++fails === 1 ? { hits: [], error: "boom" } : { hits: [] }));
  await flaky({ query: "a" });
  await flaky({ query: "a" });
  assert.equal(fails, 2);
});

test("results are wrapped as data with retrieval date", () => {
  const text = renderOutcome({ hits: [{ title: "T", url: "https://a.b", snippet: "s", published: null }] }, "2026-11-10");
  assert.match(text, /<result n="1" url="https:\/\/a\.b" published="unknown" retrieved="2026-11-10">/);
});
