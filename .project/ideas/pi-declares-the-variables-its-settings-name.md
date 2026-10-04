---
title: pi declares the key variables its settings name
created: 2026-10-04
---

For now pi's `machine()` declares only the key variables pi's provider list names, and a custom variable in a person's pi settings is the profile's to add as a need ([container/05 p5](../plans/container/05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md), task 07).
Source: Softov, 2026-10-04, chose that for now and kept the other route for later.

## What it would add

- At load, `@ahpd/agent-pi` reads the host's pi settings (`PI_CODING_AGENT_DIR`, else `~/.pi/agent`) and declares each key variable they name as a secret env need, beside the provider list's.
- A profile would no longer have to repeat a variable the host's settings already name.

## Questions it must answer first

- Which fields of pi's `settings.json` and `models.json` name a variable, and whether that is stable across pi versions.
- What happens when the host's settings change after load: read again on each `machine()`, or only at load.
