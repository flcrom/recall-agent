import test from "node:test";
import assert from "node:assert/strict";
import { calendarBlock, isoDay, stamp } from "../src/clock.ts";

const TZ = "Asia/Kolkata";
// Tuesday 10 November 2026, 19:45 IST
const NOW = new Date("2026-11-10T14:15:00Z");

test("stamp and isoDay use the configured timezone", () => {
  assert.equal(stamp(NOW, TZ), "Tue 10 Nov 2026 19:45");
  // 23:00 UTC on the 10th is already the 11th in Kolkata
  assert.equal(isoDay(new Date("2026-11-10T23:00:00Z"), TZ), "2026-11-11");
  assert.equal(isoDay(new Date("2026-11-10T23:00:00Z"), "UTC"), "2026-11-10");
});

test("calendar resolves relative days", () => {
  const cal = calendarBlock(NOW, TZ);
  assert.match(cal, /2026-11-10 Tue 10 Nov 2026 {2}<- today/);
  assert.match(cal, /2026-11-09 Mon 9 Nov 2026 {2}<- yesterday, last Mon/);
  // today is a Tuesday, so "last Tue" is a week ago, not today
  assert.match(cal, /2026-11-03 Tue 3 Nov 2026 {2}<- last Tue/);
  assert.match(cal, /2026-11-11 Wed 11 Nov 2026 {2}<- tomorrow/);
});

test("calendar covers 28 days back and 7 ahead without skipping a day across DST", () => {
  const now = new Date("2026-03-30T10:00:00Z");
  const lines = calendarBlock(now, "America/New_York").split("\n");
  assert.equal(lines.length, 36);
  const days = lines.map((l) => l.slice(0, 10));
  assert.equal(new Set(days).size, 36);
});
