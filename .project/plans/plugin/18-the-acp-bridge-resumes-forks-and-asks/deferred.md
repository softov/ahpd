---
title: The ACP bridge resumes, forks and asks - deferred
date: 2026-09-26
---

ACP v2 waits for a stable v2 SDK; the bridge stays on v1 until then.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| ACP v2, which has no `fs/*`, `terminal/*`, `session/load` or `session/set_mode`, so decision [acp-ports-come-through-start](../../../decisions/acp-ports-come-through-start.md) has no ACP caller and a session this process never watched cannot be read back | Softov, 2026-09-26: stay on v1 until a stable v2 SDK is published; the SDK ahpd uses (`^1.4.0`) is protocol version 1 | a plugin plan when the SDK publishes a stable v2 |
