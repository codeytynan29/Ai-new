# 0003 — Four additions to the §5 message shape

Added `seq`, `status`, `inReplyTo`, `usage`.

**`status` is load-bearing.** §8 requires cancellation and §16 requires graceful
provider failure, but the original schema has nowhere to put a turn that did not
finish. The options were to delete it or to leave it looking complete. Deleting
loses the record that it happened; a transcript that silently omits a failed
turn cannot be debugged. So: `streaming | complete | error | cancelled`, and the
message stays.

This has a second effect that turned out to matter more than expected — see
test F. Because `buildContext` filters on `status === 'complete'`, a failed or
cancelled turn is in the transcript but never becomes another model's context.
A half-written sentence is not something to reason against.

**`seq`** is monotonic per conversation, assigned by the store (the only
component that sees every write). It is both transcript order and the SSE
resume cursor.

**`usage`** exists because ADR 0005 needs a cost ceiling, and cost cannot be
bounded without measuring it. How reliable that measurement is depends on the
adapters, which have not been validated against live endpoints — see ADR 0009.

**`inReplyTo`** is written by the engine and, as review pointed out, read by
nothing. Keeping it anyway, with the honest reason rather than an implied
feature: it records which human turn a round answers, and that association only
exists at write time. It cannot be reconstructed later from ordering once
cancelled turns interleave or a second human joins. One nullable field is a
cheap hedge against information that is otherwise destroyed on the spot.
