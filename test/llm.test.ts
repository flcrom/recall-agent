import test from "node:test";
import assert from "node:assert/strict";
import { foldStream } from "../src/llm.ts";

async function* gen(items: string[]) {
  for (const i of items) yield i;
}

test("folds text deltas and reassembles split tool-call arguments", async () => {
  const seen: string[] = [];
  const out = await foldStream(
    gen([
      JSON.stringify({ choices: [{ delta: { content: "Checking " } }] }),
      JSON.stringify({ choices: [{ delta: { content: "now." } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "web_search", arguments: '{"query":"a' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'bc"}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 1, id: "c2", function: { name: "web_search", arguments: '{"query":"d"}' } }] } }] }),
      "[DONE]",
    ]),
    (s) => seen.push(s),
  );
  assert.equal(out.text, "Checking now.");
  assert.deepEqual(seen, ["Checking ", "now."]);
  assert.deepEqual(out.toolCalls.map((c) => [c.id, c.arguments]), [["c1", '{"query":"abc"}'], ["c2", '{"query":"d"}']]);
});

test("ignores keep-alive and malformed chunks", async () => {
  const out = await foldStream(gen(["", "not json", JSON.stringify({ choices: [{ delta: { content: "ok" } }] })]), () => {});
  assert.equal(out.text, "ok");
});
