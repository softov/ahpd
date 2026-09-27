---
title: What the agent-in-a-machine plan leaves for later
---

## Waiting

- **A warm pool of paused machines per disposable profile.** Unpausing measured 0.18 s against 0.94 s for a new container on 2026-09-26. A bind mount is fixed at create, so a pooled machine would have to mount a repository's whole worktrees folder and see its siblings. Waits until a session start is measured and found slow; it goes to a new child plan here.
- **A snapshot after a profile's setup command.** `docker commit`, invalidated when the setup text changes. Waits for profiles to have a setup command at all.
- **A host proxy for model credentials.** The machine gets a base URL and a per-session token, and the host forwards with the real key. Waits for p8 to p10, where a key would otherwise leave this host; it goes to a new child plan then.
