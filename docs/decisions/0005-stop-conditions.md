# 0005 — Four stop conditions, not one

§8 guards infinite loops. A counter does that, and it is the easy half.

The failure that will actually cost money is **convergence**: both models agree
by turn two, then spend turns three to six agreeing more elaborately. No loop,
no error, the cap never reached, nothing produced.

Four conditions, any one ends the round:

| | why |
|---|---|
| `maxTurns` | as specified |
| `maxCostUsd` | §8 says "where practical"; made mandatory. Turn count bounds nothing — one turn can be 8k tokens |
| `deadlineMs` | a provider can hang without erroring |
| convergence | the one that earns its place |

Convergence is detected two ways: word-set overlap against the previous turn
above a threshold, and a bare-agreement pattern (`"Agreed."` shares no words
with what it agrees to, so similarity alone misses it).

**This is the decision I trust least.** The similarity measure is crude — no
dependencies, no model call — and it will have false positives on genuinely
converging-but-still-useful exchanges, and false negatives on elaborate
agreement. It is isolated behind `similarity()` and `checkStop()` so it can be
replaced without touching the engine. Threshold 0 disables it entirely.

Open question for review: is this v0.1 scope, or safety theatre that should
wait for evidence? Tests D and E demonstrate it working; neither demonstrates
that it is *right*.
