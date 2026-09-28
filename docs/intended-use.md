# What this is for

Two uses, and the design has to serve both without the second contaminating
the first.

## 1. A room where two models argue about a real project

The motivating case: getting ChatGPT and Claude to discuss a specific codebase
— its architecture, its failures, what to do next — without a human copying
messages between two tabs.

**This does not mean Claude Code joins the room.** The Anthropic adapter talks
to the Messages API. That participant has no repository, no shell, and no
memory of any prior session. It is a reasoning participant, not an agent.

What makes the project case work is therefore not access but **briefing**: the
room needs somewhere to hold reference material that both models see, separate
from the conversation turns. Hand it a project's state-of-play document and the
two models can argue about the real thing rather than about a description of it.

## 2. Anything else

Ordinary conversation, thinking out loud, whatever. No project attached.

## What this implies

**Room context is generic.** Attached material is just text the room holds; the
code knows nothing about any particular project. Spec §1 requires this
("must not contain SparkPro-specific assumptions, branding, code, data, or
architecture") and use case 2 requires it independently.

**Trust levels differ and must not be collapsed.** Material the human attaches
carries the human's trust. Another model's output does not — see ADR 0004.
A briefing document and a rival model's turn are both "context", and treating
them the same would quietly undo the untrusted-content fence.

**Context has a cost.** Attached material is re-sent on every turn to every
participant. A long document in a six-turn roundtable is paid for twelve times.
Whatever ships should show the cost before a round rather than after, and the
cost ceiling in ADR 0005 becomes more load-bearing, not less.
