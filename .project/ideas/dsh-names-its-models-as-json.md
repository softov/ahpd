---
title: dsh names its ACP models with plain ids
created: 2026-11-11
refs:
  - "[code://packages/agent-acp/src/session/config.ts#L181-L185](../../packages/agent-acp/src/session/config.ts#L181-L185) - ahpd shows each `modelId` as the server sends it"
---

dsh's ACP server sends model ids such as `["deepseek-official","deepseek-v4-flash"]`, a JSON array written as a string.
ahpd passes them through, so a picker and `ahpc agents --json` show the brackets and quotes.
A change in dsh, outside this repository, could send `deepseek-official/deepseek-v4-flash` and a `name` of its own.
