---
title: A Claude turn reads its message's attachments, queued and steered ones included - deferred
date: 2026-10-07
---

The plan sends a begun, a queued and a steering message's attachments, which is what a client sends; a turn resumed by `chat/turnResume` waits.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| A resumed turn sends its message's attachments | The plan named `begin`, `queue` and `steer`; `resume` re-runs a turn the CLI never took and none of the plan's decisions covers it | unplanned |
