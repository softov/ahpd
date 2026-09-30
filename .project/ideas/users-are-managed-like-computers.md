---
title: Users are managed through the host, the way computers are
created: 2026-09-29
---

Raised with daemon/11, which leaves `users` out of root config.

The users file could be served as a scheme a client reads and writes, as `computer:` is ([plugin/10](../plans/plugin/10-a-computer-a-person-manages/plan.md)), with each record checked before it is written, so a person with the right grant manages users from ahpapp.

## Questions it leaves

- The grant that writes a user, and whether a person may change their own record.
- Whether it belongs in root config instead, as a list of records under `config:write`.
