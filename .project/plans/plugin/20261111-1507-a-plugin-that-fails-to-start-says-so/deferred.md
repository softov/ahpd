---
title: A plugin that fails to start says so - deferred
date: 2026-11-11
---

The problem asked one more question, and this plan changed only the `listening` text.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Whether a `stopping` alert stays on a plugin that is then unloaded | nobody has read the unload path for it; the problem asked it at `git://89cfcd7ad` | unplanned |
