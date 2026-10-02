---
title: A prompt carries what the agent accepts - deferred
date: 2026-10-02
---

- A queued message loses its attachments, because `Session.queue` takes none. It is the same on every backend, so it belongs with the SDK's queue rather than here.
- The ACP agent does not advertise `multipleDirectories`, so a host never hands `start.additional` to it; the directory case is tested on `acpSession` directly.
