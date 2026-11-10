import { dayLabel, isoDay, stamp } from "./clock.ts";
import type { ChatMessage } from "./llm.ts";
import type { Turn } from "./store.ts";

const TRIMMED_ANSWER_CHARS = 320;

function render(t: Turn, tz: string, trim: boolean): ChatMessage {
  const when = `[${stamp(new Date(t.ts), tz)}]`;
  if (t.role === "user") return { role: "user", content: `${when} ${t.content}` };
  let body = t.content;
  if (trim && body.length > TRIMMED_ANSWER_CHARS) body = body.slice(0, TRIMMED_ANSWER_CHARS).trimEnd() + " [rest of answer trimmed]";
  const urls = [...new Set((t.searches ?? []).flatMap((s) => s.urls))].slice(0, 8);
  const searched = t.searches?.length ? `\n[searched ${isoDay(new Date(t.searches[0].at), tz)}; sources: ${urls.join(" ")}]` : "";
  return { role: "assistant", content: `${when} ${body}${searched}` };
}

const size = (ms: ChatMessage[]) => ms.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);

/**
 * Turns the stored thread into model messages. Everything is stamped with the
 * time it happened. When the thread outgrows the budget, old answers are
 * trimmed first, then the oldest turns are dropped but still listed in an
 * index of dated questions, so "what did I ask on 3 November" keeps working.
 */
export function buildHistory(turns: Turn[], tz: string, budgetChars = 48_000): ChatMessage[] {
  const trimUpTo = (n: number) => turns.map((t, i) => render(t, tz, i < n));
  let trimmed = 0;
  let out = trimUpTo(0);
  while (size(out) > budgetChars && trimmed < turns.length) {
    trimmed++;
    out = trimUpTo(trimmed);
  }
  if (size(out) <= budgetChars) return out;

  let dropped = 0;
  while (size(out.slice(dropped)) > budgetChars && dropped < turns.length - 1) dropped++;
  const index = turns
    .slice(0, dropped)
    .filter((t) => t.role === "user")
    .map((t) => `${isoDay(new Date(t.ts), tz)} ${dayLabel(new Date(t.ts), tz).slice(0, 3)}: ${t.content.replace(/\s+/g, " ").slice(0, 160)}`)
    .join("\n");
  const head: ChatMessage = {
    role: "system",
    content: `Older part of the conversation, answers omitted. Questions the user asked then:\n${index || "(none)"}`,
  };
  // Keep the kept window starting on a user turn so roles alternate cleanly.
  let rest = out.slice(dropped);
  while (rest.length && rest[0].role !== "user") rest = rest.slice(1);
  return [head, ...rest];
}
