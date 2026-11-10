import test from "node:test";
import assert from "node:assert/strict";
import { buildHistory } from "../src/history.ts";
import type { Turn } from "../src/store.ts";

const TZ = "Asia/Kolkata";
const turns: Turn[] = [
  { ts: "2026-11-03T05:00:00Z", role: "user", content: "Best Postgres hosting for a small team?" },
  {
    ts: "2026-11-03T05:00:20Z",
    role: "assistant",
    content: "Neon Launch is $19/month.",
    searches: [{ query: "neon pricing", at: "2026-11-03T05:00:10Z", urls: ["https://neon.com/pricing"] }],
  },
];

test("every turn is stamped with local time and answers keep their sources", () => {
  const h = buildHistory(turns, TZ);
  assert.equal(h.length, 2);
  assert.match(String(h[0].content), /^\[Tue 3 Nov 2026 10:30\] Best Postgres/);
  assert.match(String(h[1].content), /Neon Launch is \$19\/month\./);
  assert.match(String(h[1].content), /searched 2026-11-03; sources: https:\/\/neon\.com\/pricing/);
});

test("over budget: old answers are trimmed before anything is dropped", () => {
  const long: Turn[] = [
    { ts: "2026-11-01T05:00:00Z", role: "user", content: "q1" },
    { ts: "2026-11-01T05:00:05Z", role: "assistant", content: "a".repeat(2000) },
    { ts: "2026-11-02T05:00:00Z", role: "user", content: "q2" },
    { ts: "2026-11-02T05:00:05Z", role: "assistant", content: "b".repeat(100) },
  ];
  const h = buildHistory(long, TZ, 1000);
  assert.equal(h.length, 4);
  assert.match(String(h[1].content), /rest of answer trimmed/);
  assert.equal(String(h[3].content).includes("b".repeat(100)), true);
});

test("far over budget: oldest turns drop but their questions stay in a dated index", () => {
  const many: Turn[] = [];
  for (let i = 1; i <= 30; i++) {
    const day = String(i).padStart(2, "0");
    many.push({ ts: `2026-10-${day}T05:00:00Z`, role: "user", content: `question number ${i}` });
    many.push({ ts: `2026-10-${day}T05:00:05Z`, role: "assistant", content: "x".repeat(200) });
  }
  const h = buildHistory(many, TZ, 2500);
  assert.equal(h[0].role, "system");
  assert.match(String(h[0].content), /2026-10-01 Thu: question number 1\b/);
  assert.equal(h[1].role, "user");
  const last = String(h[h.length - 1].content);
  assert.match(last, /x{200}/);
});
