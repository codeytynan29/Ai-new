# 0009 — Independent review: what it found and what changed

ChatGPT reviewed the architecture as an independent track. It found three real
defects and one weak justification. Everything below either changed or is
answered.

## Accepted — the SSE cursor was broken

> The cursor is a message's `seq`, while the stream contains several events per
> message… a disconnect during generation loses the start and all deltas.

Correct, and worse than described. Verified against the code:

- only `message-end` carried an SSE `id`, so `Last-Event-ID` advanced only on
  completed messages
- replay re-sent **every** message with `seq > since` labelled `message-end`,
  including ones still `streaming` — telling the browser a turn had finished
  while it was still being written
- `await store.getMessages()` ran before the subscription was registered, so an
  event published between those two steps reached nobody

The cursor now addresses **events**, not messages. Every event gets a monotonic
id from a per-conversation log, and replay returns exactly the events missed.
The subscription is registered *before* replay, with live events buffered and
de-duplicated by id, so the window is closed.

`test/sse.test.ts` boots the real server, drops the connection mid-generation,
reconnects with `Last-Event-ID`, and asserts the replay contains event types a
message-addressed cursor could never have produced.

**Still true and now documented:** resume only works within one process
lifetime. The log is in memory, capped at 2000 events per conversation.

## Accepted — the similarity measure was wrong

> `similarity()` is word overlap divided by the size of the smaller word set.
> That makes short, generic responses especially risky.

Correct, and the example given scores worse than "highly similar": measured at
**1.00**. Dividing by the smaller set is the overlap coefficient, and any turn
whose words are a subset of a longer one is a perfect match — so a turn that
*added* a qualification read as an echo.

Now Jaccard: shared over union. Symmetric, no short-turn bias. Test E2 asserts
both properties using the reviewer's own example.

## Accepted — convergence detection is off by default

> I would not make this convergence rule a default stop condition… Tests
> showing that the heuristic fires demonstrate its mechanics, not that stopping
> was correct.

That last sentence is the whole argument and it is right. ADR 0005 already said
this was the decision I trusted least; the review supplied the reason.

Two changes:

- **Default `convergenceThreshold: 0`** — off. `maxTurns`, cost and deadline
  remain on. Convergence is opt-in.
- **Two consecutive flat turns, not one.** A single `"Agreed."` used to end a
  round on turn two, before the second participant had been responded to at all.
  One flat turn is a pause; two in a row is a pattern.

Not adopted: moving it to telemetry-only. It stays implemented and off, because
the measurement the reviewer wants comes from the same code either way, and a
disabled branch is cheaper to keep honest than a parallel logging path.

## Accepted — the cost ceiling was quietly unreliable

> a missing or unrecognized model price can make the reported cost wrong.

An unknown model silently borrowed Opus pricing. It now warns once and estimates
**high** — a ceiling that trips early is recoverable; one that trips late has
already spent the money.

The reviewer's broader point stands unchanged: until the adapters run against
live endpoints, the ceiling is best-effort.

## Accepted — the fence is a mitigation, not a boundary

> tags and a standing note are mitigations, not an enforcement boundary: the
> receiving model can still follow instructions inside them.

Correct and important. ADR 0004 amended accordingly. The clause is still worth
having in §20 — it removes the *easy* version of the attack and makes the
trust level explicit — but it must not be described as making injection safe.
Nothing in this architecture can.

## Corrected — `inReplyTo` had no named justification

> the supplied rationale should identify the concrete feature that needs it.

Fair. Checked: it is written by the engine and read by nothing.

Keeping it, with an honest reason rather than the implied one. It records which
human turn a round answers, and that association is available only at write
time — it cannot be reconstructed later from ordering once cancelled turns
interleave or a second human joins. One nullable field is a cheap hedge against
information that is otherwise destroyed. ADR 0003 now says that instead of
implying a feature depends on it.

## Answered, not changed — WebSockets

> Multi-human rooms alone would not force a WebSocket rewrite.

Agreed, and this is a genuine correction to ADR 0001, which listed multi-human
as the thing that would change the decision. It would not: client-originated
events still work over POST. The real triggers are sustained bidirectional
streaming or presence. ADR 0001's "weakest point" section is wrong as written
and is corrected there.
