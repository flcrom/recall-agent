import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SearchRecord {
  query: string;
  since?: string;
  /** ISO time the search ran. */
  at: string;
  urls: string[];
}

export interface Turn {
  /** ISO UTC time the message was sent or produced. */
  ts: string;
  role: "user" | "assistant";
  content: string;
  /** Present on assistant turns: what was searched to produce the answer. */
  searches?: SearchRecord[];
}

/**
 * One append-only JSONL file per thread. A thread is one person's whole
 * relationship with the agent, so "what did I ask on 3 November" is a read,
 * not a search.
 */
export class Store {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(thread: string): string {
    const safe = thread.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "default";
    return join(this.dir, `${safe}.jsonl`);
  }

  load(thread: string): Turn[] {
    const f = this.file(thread);
    if (!existsSync(f)) return [];
    const turns: Turn[] = [];
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        turns.push(JSON.parse(line) as Turn);
      } catch {
        // A torn last line from a crash must not take the whole history down.
      }
    }
    return turns;
  }

  append(thread: string, ...turns: Turn[]): void {
    appendFileSync(this.file(thread), turns.map((t) => JSON.stringify(t) + "\n").join(""));
  }
}
