---
title: Each area of the host has one doc
domain: documentation
status: planned
priority: medium
created: 2026-10-08
revalidated: 2026-10-08
requires: []
changes: []
creates: []
decisions: []
refs:
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - 1043 lines; automations, configuration and who may connect move out"
  - "[code://docs/USERS.md](../../../../docs/USERS.md) - 683 lines; the door, the issuer and trusted folders move out"
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - the surface; its session and chat behaviour is linked from the new docs"
  - "[code://docs/PLUGINS.md](../../../../docs/PLUGINS.md) - how a plugin serves a scheme, linked from RESOURCES.md"
---

## Goal

Each area of the host has one doc in `docs/` that defines its terms and says how it works today.
The areas are sessions, chats, automations, the host and its root, terminals, authentication, resources, usage and tools.
A reader finds an area by its file name, and `docs/README.md` says what each file covers.
Text that describes an area moves out of DAEMON.md and USERS.md into the area's doc.
A decision keeps its rationale; the doc states the result and links the decision.
Softov, 2026-10-08: "make a file for each sector ... so we can define things in there, maybe move some information from decisions, or from others doc."

## Reconnaissance

### Searches performed

- `wc -l docs/*.md` - ten docs, 5521 lines; DAEMON.md and PLUGINS.md each hold over 1000.
- `grep -n "^## " docs/DAEMON.md docs/USERS.md docs/AHP.md` - the sections each move names.
- `rg -ln "code://packages/sdk/src/host/<area>" .project/decisions/` - the decisions each area doc links; run per area.

### Gaps

- `Not found: a doc for usage, terminals, chats or tools - searched docs/ for "## Usage", "terminal", "chat", "MCP".`

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| One doc each: SESSIONS, CHATS, AUTOMATIONS, HOST, TERMINALS, AUTHENTICATION | Softov, 2026-10-08 | 01-04 |
| Also RESOURCES, USAGE, TOOLS and a `docs/README.md` index | Softov's answer to "Which other area docs should come with the six you named?", 2026-10-08 | 04-06 |
| Moved text leaves one line and a link where it was | (defaulted: links into DAEMON.md and USERS.md keep working) | 01-05 |
| A doc states what is true and links the decision for why; it does not copy a decision's rationale | memory `docs-read-as-human-written` | 01-05 |
| Softov reads the diff before anything is committed | Softov, 2026-10-08 | all |

## Proposed architecture

- **Shape of an area doc** - what it is, in two or three sentences, and its terms, one line each. Then how it works, and its config keys with each option explained. Then its CLI commands and the grants it asks. Last, links to AHP.md rows and decisions.
- **Source of truth** - the code. Every claim is checked against the file it names, and a claim the code contradicts is fixed in the doc, not copied.
- **Style** - short and direct, one paragraph per line, no em dash, no third-party project cited.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - authentication](task-01-authentication.md) | todo | - |
| [02 - host and automations](task-02-host-and-automations.md) | todo | - |
| [03 - sessions and chats](task-03-sessions-and-chats.md) | todo | - |
| [04 - terminals and tools](task-04-terminals-and-tools.md) | todo | - |
| [05 - resources and usage](task-05-resources-and-usage.md) | todo | - |
| [06 - the index](task-06-the-index.md) | todo | 01, 02, 03, 04, 05 |

## Risks and tradeoffs

- A moved section breaks a link from elsewhere. Each task runs `rg -n "DAEMON.md#|USERS.md#" .` and fixes what it moved.
- Area docs and AHP.md can say the same thing twice. AHP.md keeps the wire rows; an area doc links them.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-authentication.md](task-01-authentication.md).
- **Open questions:** none.
- **Watch out for:** plugin/38 adds a read-only section to PLUGINS.md; this plan does not move PLUGINS.md text.

## Final verification checklist

- [ ] Every new doc follows the shape above and every claim was read against its code.
- [ ] `rg -n "DAEMON.md#|USERS.md#" .` resolves.
- [ ] Softov has read the diff.
- [ ] `plans/index.md` updated.
