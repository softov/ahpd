---
title: A turn with no update for a while says it is waiting
created: 2026-11-11
refs:
  - "[code://.project/working/release-run.md](../working/release-run.md) - the agent tests, where Gemini's default model ran 4 minutes with nothing shown"
---

On 2026-11-11 a Gemini turn on the default model `auto` showed nothing for 4 minutes.
Google answered 503, and the CLI retried on its own.
ACP carried no update in that time, so a person saw a turn running and no reason.
A turn that hears nothing for a set time could show a status, such as "No answer from the agent for 60 s".
It applies to every engine, and a setting would name the time.
