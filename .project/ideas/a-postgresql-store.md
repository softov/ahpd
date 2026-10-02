---
title: A postgresql plugin lets several daemons share one set of stores
created: 2026-10-02
---

The same ports as the [sqlite store](a-sqlite-store.md) (`sessions`, `automations`, `usage`, `vault`, and `users` once it can be registered), kept in a postgresql database several daemons point at.
What sqlite cannot give is the reason for it: one place for usage totals, people and secrets across hosts, so a team's budget and a person's grants are the same on every daemon they use.

## What sharing changes

- **Usage.** A limit checked on one daemon has to see what another spent. Whether checks read the shared totals or keep local totals that sync is a daemon setting the usage rules already expect.
- **People.** Users, teams, projects and roles edited on one host apply on all of them, which is what lets a person sign in anywhere with one record.
- **Secrets.** A vault several hosts read needs its secrets encrypted with a key none of them stores in the database.
- **Sessions and automations.** A session belongs to the daemon running it; a shared store must key it by host, and an automation must fire on one daemon, not on each.

## Questions it leaves

- One package with a driver option beside sqlite, or its own package; a postgres client is a dependency, which is Softov's call.
- Which ports are shared and which stay per host: sessions and automations may want to stay local while usage, people and the vault are shared.
- How a daemon learns another changed something it caches (people, totals): `LISTEN`/`NOTIFY`, polling, or reading through every time.
- The schema's version and its migrations, owned by the plugin.
