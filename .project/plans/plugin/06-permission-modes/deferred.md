---
title: The facio backend offers a permission mode and a thinking level - deferred
date: 2026-09-20
---

The core now knows six modes, and the terminal program still names four; nothing waits on anything but that program's own decision to offer the other two.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| `plan` and `auto` in papo's `permissions` setting | The move into the core was made without changing what the CLI accepts, so its config enum and its `PERMISSION_MODES` list are unchanged; adding two values is a change to that program's surface rather than to the harness | papo's own configuration, unplanned; the core's `policyOf` already takes both |
| A daemon check of a chosen level against a real endpoint | It needs a provider key and a model that accepts `reasoning_effort`; the request body is asserted with a stubbed endpoint instead | unplanned |
| The `@facio/config` layered reader for the harness file | Still the plan 04 deferral; the mode and effort work did not touch the reader | [plugin/04 deferred](../04-agent-facio-extras/deferred.md) |
