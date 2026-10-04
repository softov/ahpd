---
title: A chat move - deferred
date: 2026-10-03
---

- A move into a session of another agent provider: a chat's conversation is in its backend's own format, and no backend here reads another's. Refused with a reason; open for later, per Softov, 2026-10-03: "Same agent and machine for now... future case open".
- A move into a session on another computer: the conversation is on the machine that ran it, and nothing copies it to another. Refused with a reason; open for later, from the same answer.
- A nested chat, and an ACP chat whose server lacks `loadSession`, never say they can move, because neither can be resumed by its id; a move for them waits on a way to carry the conversation over.
