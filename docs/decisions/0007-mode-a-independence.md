# 0007 — Mode A is independent; commit order is fixed

Two decisions, one mechanism.

**Independence.** §7 says Mode A means "both respond independently". Read
strictly: neither model sees the other's answer *for that turn*. Test A asserts
this. It is a genuine ambiguity in the spec — §22's test 4 ("Claude receives
OpenAI response") reads as though it might apply to Mode A, so that test is
implemented against roundtable, where it is unambiguous.

Encoded as a test rather than argued in prose, so it can be overturned with
evidence. If Mode A should be a delayed roundtable, test A is the thing to
delete and the conversation to have.

**Commit order.** Placeholders are created in fixed provider order before any
request is issued, so `seq` is determined before generation starts. Both
requests then run concurrently and stream into their own slots.

This gets the latency of parallel generation with a deterministic, replayable
transcript, and removes the question "what did Claude see of ChatGPT's
half-written message" — structurally, nothing. §9 offered simultaneous or
sequential; this is neither, and better than both.

Test B proves order holds when the second provider finishes first.
