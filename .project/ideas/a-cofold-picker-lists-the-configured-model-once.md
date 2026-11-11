---
title: A cofold picker lists the configured model once
created: 2026-11-11
refs:
  - "[code://packages/agent-cofold/src/agent.ts](../../packages/agent-cofold/src/agent.ts) - the catalogue a cofold record offers"
---

A cofold record on OpenRouter with `deepseek/deepseek-chat` offers that id first, and `cf-or/deepseek/deepseek-chat` from the endpoint's list after it.
Both rows are the same model, and a person cannot tell which one to pick.
The configured model could take the qualified id of the row it matches, so the picker shows it once.
