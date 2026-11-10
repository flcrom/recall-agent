export interface SearchArgs {
  query: string;
  /** YYYY-MM-DD. Only return pages published on or after this day. */
  since?: string;
  topic?: "general" | "news";
  /** Restrict to one site, e.g. "hubspot.com". */
  site?: string;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  published: string | null;
}

export interface SearchOutcome {
  hits: SearchHit[];
  error?: string;
}

export type SearchFn = (args: SearchArgs) => Promise<SearchOutcome>;

const SNIPPET_CHARS = 900;
const TIMEOUT_MS = 10_000;

export function tavilySearch(apiKey: string, fetchImpl: typeof fetch = fetch): SearchFn {
  return async (args) => {
    const body: Record<string, unknown> = {
      query: args.query,
      topic: args.topic ?? "general",
      search_depth: "basic",
      max_results: 6,
      include_published_date: true,
    };
    if (args.since && /^\d{4}-\d{2}-\d{2}$/.test(args.since)) body.start_date = args.since;
    if (args.site) body.include_domains = [args.site.replace(/^https?:\/\//, "").replace(/\/.*$/, "")];

    let lastError = "unknown error";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.status === 429 || res.status >= 500) {
          lastError = `search provider returned ${res.status}`;
          continue;
        }
        if (!res.ok) return { hits: [], error: `search provider returned ${res.status}` };
        const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
        const hits = (json.results ?? []).map((r) => ({
          title: String(r.title ?? ""),
          url: String(r.url ?? ""),
          snippet: String(r.content ?? "").slice(0, SNIPPET_CHARS),
          published: typeof r.published_date === "string" ? r.published_date : null,
        }));
        return { hits };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
    return { hits: [], error: lastError };
  };
}

/**
 * Identical searches inside the TTL share one request, including requests
 * that are still in flight. Errors are not cached.
 */
export function cached(inner: SearchFn, ttlMs = 10 * 60_000, now: () => number = Date.now): SearchFn {
  const entries = new Map<string, { at: number; value: Promise<SearchOutcome> }>();
  return (args) => {
    const key = JSON.stringify([args.query.trim().toLowerCase(), args.since ?? "", args.topic ?? "", args.site ?? ""]);
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    const value = inner(args).then((out) => {
      if (out.error) entries.delete(key);
      return out;
    });
    entries.set(key, { at: now(), value });
    return value;
  };
}

/** Search text handed to the model. Results are data, never instructions. */
export function renderOutcome(out: SearchOutcome, retrievedOn: string): string {
  if (out.error) return `Search failed: ${out.error}. Say so if it affects the answer.`;
  if (!out.hits.length) return "No results.";
  const body = out.hits
    .map(
      (h, i) =>
        `<result n="${i + 1}" url="${h.url}" published="${h.published ?? "unknown"}" retrieved="${retrievedOn}">\n${h.title}\n${h.snippet}\n</result>`,
    )
    .join("\n");
  return `<search_results>\n${body}\n</search_results>`;
}
