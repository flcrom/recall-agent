# recall-agent

A chat agent with one tool, web search. It remembers what you asked and when, and re-checks its own earlier answers against the web. See [DESIGN.md](DESIGN.md) for why it is built this way.

## Run

```
npm install
cp .env.example .env   # fill in the keys
npm run dev
```

Open http://localhost:3000. `npm run chat` gives the same agent in a terminal.

Keys (see `.env.example`):

- `TAVILY_API_KEY`: search. The free tier is enough.
- `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`: any OpenAI-compatible chat completions endpoint with tool calling. Defaults to OpenAI and `gpt-4.1-mini`. For OpenRouter set `LLM_BASE_URL=https://openrouter.ai/api/v1` and a model id.

`AGENT_TZ` sets the time zone used for "Monday" and "yesterday". It defaults to the machine's.

## Tests

```
npm test
npm run typecheck
```

The tests use a fake model, a fake search and a fixed clock. They cover date resolution, history stamping and trimming, parallel searches, the forced final answer, the search cache, stream parsing and thread ordering.

## Conversation history

Each thread is `data/<thread>.jsonl`, one JSON object per line:

```json
{"ts":"2026-11-03T04:30:00.000Z","role":"user","content":"Which Postgres host should we use?"}
{"ts":"2026-11-03T04:30:20.000Z","role":"assistant","content":"...","searches":[{"query":"neon pricing","at":"2026-11-03T04:30:10.000Z","urls":["https://neon.com/pricing"]}]}
```

The web UI and CLI use the thread `default`. `POST /api/chat` with `{"message": "...", "thread": "name"}` streams server-sent events (`text`, `search`, `done`, `error`). `GET /api/history?thread=name` returns the stored turns. To test recall of an earlier day, write turns with the timestamps you want into a thread file.
