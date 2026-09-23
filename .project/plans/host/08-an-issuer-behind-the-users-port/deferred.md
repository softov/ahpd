---
title: An issuer vouches for a person, and the directory still decides what they may do - deferred
date: 2026-09-23
---

The simple verifier lands first; what waits below needs either a later plan or an answer an issuer has not given yet.

| What | Why it waits | Where it goes |
| --- | --- | --- |
| Verifying a JWT locally against the issuer's key set | The smaller network cost and the larger code: JOSE parsing, a key cache and clock handling. It does not help GitHub, which issues opaque tokens | a later host plan, behind the same `issuer` option |
| Roles from the issuer's claims or groups | It needs a claim mapping, an issuer that carries groups, and a policy for a missing claim | a later host plan |
| An issuer's token accepted at the connection token | A client obtains one only after connecting, so there is nothing to present before the socket exists. A record with no local secret is therefore a protocol credential and not a door key | unplanned |
| Refreshing or revoking an issuer's token on the host's own initiative | `expiresIn` is the client's to send and `auth/required` is the hook that already exists; nothing here needs more | unplanned |
