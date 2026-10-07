---
title: Claude runs its client calls through the sdk - deferred
date: 2026-10-06
---

Anything that needs a real CLI and a client to talk to it waits for a machine this work may not start.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| The by-hand run: a claude session on ahpd with a client's tool, reading the log to see whether `claudecode/toolUseId` arrives on every call | It needs a live daemon, a real CLI and a client that answers a tool call; the task may not start a daemon, and the fake SDK is what the cases drive instead | this plan, when somebody runs it |
| Removing the name-and-input fallback and the warning that comes with it | It is a question about what a live CLI sends, and the run above is what answers it; the decision is Softov's | this plan, after that run |
