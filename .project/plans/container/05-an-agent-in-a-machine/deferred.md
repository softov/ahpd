---
title: An agent in a machine is built once, started fast, and reached from anywhere - deferred
date: 2026-10-02
---

These wait for a measurement or for a feature the children do not build.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A warm pool of paused machines per disposable profile | Unpausing measured 0.18 s against 0.94 s for a new container on 2026-09-26, and a bind mount is fixed at create, so a pooled machine would have to mount a repository's whole worktrees folder and see its siblings; it waits until a session start is measured and found slow | a new child plan here |
| A snapshot after a profile's setup command, by `docker commit`, invalidated when the setup text changes | profiles have no setup command yet | unplanned |
| A host proxy for model credentials: the machine gets a base URL and a per-session token, and the host forwards with the real key | planned on its own, before any machine leaves this host | [p12](../05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/plan.md) |
