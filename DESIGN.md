# Design

A chat agent with one tool, `web_search`. It is built around two failure modes the example questions point at: getting time wrong ("last Tuesday") and calling an old answer "still correct" without checking.

## How it works

One loop, no framework (`src/agent.ts`). Per turn: build the prompt, call the model, run any `web_search` calls it makes in parallel, feed the results back, repeat. After two search rounds the model is called with `tool_choice: none`, so a turn always ends in an answer. Tokens stream to the browser as they arrive.

**Time is data, not reasoning.** Models are bad at weekday arithmetic, so the prompt carries a calendar (`src/clock.ts`): the last 28 days and next 7, newest first, each tagged `today`, `yesterday`, `last Tue`. Every message in the history is stamped with its local send time. "Last Tuesday" becomes a lookup. If a reference is ambiguous, the model is told to state the date it picked.

**Memory is the transcript, read in full, not searched.** Each person has one append-only JSONL thread (`src/store.ts`). "What did I ask on 3 November?" is answered from the prompt with no tool call. Assistant turns also store which searches ran and which URLs came back, so a later turn knows what an answer rested on. When a thread outgrows its budget (`src/history.ts`), old answers are trimmed first, then the oldest turns are dropped but their dated questions stay in an index.

**Staleness is a procedure.** For "is that still right" or "what changed since", the prompt requires: pull the claims that can change out of the original answer, check each current value, search with `since` set to the answer's date for news after it, and label every item changed, unchanged, or could not verify. "Unchanged" is allowed only for a subject searched in that turn. Search results carry published and retrieved dates, and the answer must cite them.

**Speed.** No planner or router call before the main call, so a question that needs no search costs one model round trip. Searches in a round run concurrently. Identical searches inside ten minutes share one request, including in-flight ones. The provider call and the model call both retry transient errors.

**Untrusted text.** Search results are wrapped as `<result>` data and the prompt says never to follow instructions inside them.

## Considered and rejected

- Vector memory over past turns. Threads are small and exact dates matter more than similarity.
- A planner/critic pair of model calls. Better coverage on paper, but every extra call adds seconds before the first token.
- LLM summaries of old turns. Lossy on dates and prices, and a second model call. Deterministic trimming with a dated index keeps the facts that recall needs.
- A date-parsing library. It must pick one reading of "Monday"; the calendar lets the model see both and say which it chose.
- A page-fetch tool. The brief gives one tool. Search results include page text, and `site` can target an official domain.

## Limits

- Coverage is enforced by the prompt, not by code. In testing, a weak model once reported a subject as unchanged without searching it, which prompted the "not checked" rule. A stronger model follows it better, but the guarantee is soft.
- The `since` filter drops undated pages, so official pricing pages need a separate search without it. The prompt asks for both; models sometimes only do one.
- I tested with free OpenRouter models, which are slow to a first token (17 to 45 seconds with reasoning models). Latency numbers from that setup are not a measure of the architecture.

## With another week

1. An eval set: the three example questions plus variants, run against a fake clock and recorded search fixtures, scored on date resolution, search coverage and false "unchanged".
2. Make coverage structural. Have the model list the subjects of a re-check in a tool argument, and check in code that each got a current-value search before the final call.
3. Summaries of old turns that keep dates, prices and URLs as structured fields.
4. Per-session threads on top of the per-person one, and time zones taken from the client.
