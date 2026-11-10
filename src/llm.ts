export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface Completion {
  text: string;
  toolCalls: ToolCall[];
}

export interface CompleteOptions {
  messages: ChatMessage[];
  tools: ToolSpec[];
  /** "none" forces a plain answer. Used on the last round. */
  toolChoice: "auto" | "none";
  onText: (chunk: string) => void;
  signal?: AbortSignal;
}

export type Llm = (opts: CompleteOptions) => Promise<Completion>;

/** Reads an SSE body and yields each `data:` payload. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) yield line.slice(5).trim();
    }
  }
  const tail = buf.trim();
  if (tail.startsWith("data:")) yield tail.slice(5).trim();
}

/** Folds streamed chat-completion chunks into text plus complete tool calls. */
export async function foldStream(payloads: AsyncIterable<string>, onText: (s: string) => void): Promise<Completion> {
  let text = "";
  const calls: ToolCall[] = [];
  for await (const p of payloads) {
    if (p === "[DONE]") break;
    let chunk: { choices?: Array<{ delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
    try {
      chunk = JSON.parse(p);
    } catch {
      continue;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const i = tc.index ?? 0;
      calls[i] ??= { id: "", name: "", arguments: "" };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].name += tc.function.name;
      if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
    }
  }
  return { text, toolCalls: calls.filter((c) => c.name).map((c, i) => ({ ...c, id: c.id || `call_${i}` })) };
}

const RETRIES = 3;
const RETRY_DELAY_MS = 1500;

export function openAiCompatible(opts: { baseUrl: string; apiKey: string; model: string; fetchImpl?: typeof fetch }): Llm {
  const f = opts.fetchImpl ?? fetch;
  return async (o) => {
    const body = JSON.stringify({
      model: opts.model,
      messages: o.messages,
      tools: o.tools,
      tool_choice: o.toolChoice,
      temperature: 0.3,
      stream: true,
    });
    const headers = {
      "content-type": "application/json",
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
    };
    // Rate limits and brief provider outages are retried before any text has streamed.
    let res!: Response;
    for (let attempt = 0; ; attempt++) {
      res = await f(`${opts.baseUrl}/chat/completions`, { method: "POST", headers, body, signal: o.signal });
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt >= RETRIES) break;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`LLM request failed: ${res.status} ${detail.slice(0, 300)}`);
    }
    return foldStream(sseData(res.body), o.onText);
  };
}
