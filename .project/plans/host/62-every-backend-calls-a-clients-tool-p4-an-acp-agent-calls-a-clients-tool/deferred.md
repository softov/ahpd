---
title: An ACP agent calls a client's tool - deferred
date: 2026-10-06
---

Two things wait: a run that needs a live daemon, and a corner the plan's pairing rule does not cover.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| The by-hand run: an ACP agent on ahpd, VS Code connected to it, the agent calling one of VS Code's tools - and the notes on the `name` and `title` the agent reported, on whether `_meta['claudecode/toolUseId']` arrived, and on whether the agent listed again after `list_changed` | It needs a live daemon, a real ACP agent that takes HTTP MCP servers and a VS Code with a tool of its own to call; this work may not start a daemon, and the fake server in `test/fixtures/acp-server.mjs` is what the cases drive instead | this plan, when somebody runs it |
| Pairing a `tools/call` with a call the owning client has already answered | The decision `_meta, args, oldest` reads open calls only, and a settled call is not an open one, so a client that answers before the agent's request arrives is one the request never finds: it opens a row of its own and the agent waits on a client it has already heard from. Fixing it means pairing a request with a finished call, which is a rule the plan does not decide and a question about what a live agent's ordering looks like - the run above is what answers it | this plan, after that run, as a decision first |
