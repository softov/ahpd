---
title: An issuer vouches for a person, and the directory still decides what they may do - deferred
date: 2026-09-23
---

What waits below is real work with a real blocker, and nothing else about the issuer is waiting.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Verifying a JWT locally against the issuer's key set | The smaller network cost and the larger code: JOSE parsing, a key cache and clock handling. It does not help GitHub, which issues opaque tokens | a later host plan, behind the same `issuer` option; proposed in [ideas/verify-a-jwt-locally.md](../../../ideas/verify-a-jwt-locally.md) |
| Roles from the issuer's claims or groups | It needs a claim mapping, an issuer that carries groups, and a policy for a missing claim | a later host plan |
