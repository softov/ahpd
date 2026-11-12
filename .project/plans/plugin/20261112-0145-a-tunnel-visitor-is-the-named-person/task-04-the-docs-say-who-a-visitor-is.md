---
title: The docs say who a tunnel visitor is
status: implemented
depends: [task-03-tunnel-streams-come-into-the-process.md]
layer: "docs"
refs:
  - "[code://docs/plugins/tunnel-devtunnel.md](../../../../docs/plugins/tunnel-devtunnel.md) - the plugin's page"
  - "[code://docs/updates/v0_15.md](../../../../docs/updates/v0_15.md) - the release notes"
---

## Objective

The plugin's page says who a tunnel visitor is, and the release notes say the change.

## Files

- `UPDATE: docs/plugins/tunnel-devtunnel.md` - the `person` setting, and who a visitor is on a host with users and on one without.
- `UPDATE: docs/updates/v0_15.md` - one line: a tunnel visitor gets the named person's grants, and no local port listens.

## Steps

1. Add `person` to the settings table of `tunnel-devtunnel.md`.
2. Write who a visitor is in three cases: with a person, with no users, and with users and no person.
3. Remove any text that says the hop listens on a port.
4. Add the line to `v0_15.md`.

## Validation

- Read the page against the behaviour of task 03, case by case.

## Resume

Implemented 2026-11-11, uncommitted in the worktree.

- `docs/plugins/tunnel-devtunnel.md` is one include of `packages/tunnel-devtunnel/README.md` from line 2 on, so the page's text is the README and the edits land there. The page itself is unchanged.
- The README's "The tunnel kind" section has the settings: the JSON example carries `person` (task-02), and a new paragraph says it is `user:` and the id, whose grants a visitor gets, that a saved change of person reaches the running tunnel, and that a host with users needs one.
- The README's "The connection token" section no longer says the hop listens and sets the daemon's token on every request. It says no local port listens, and gives who a visitor is in the three cases the plan names: a named person's key, a host with users and no person answered 401 with an alert, and a host with no users carrying the derived token as it is or the daemon's token in its place. It also says a port other than 31546 is carried unchanged, and that the derived token is still printed when the daemon is guarded and the plugin was not handed the token.
- The README's startup list, step 4, carries the connection in the daemon's process with no local listener.
- `docs/updates/v0_15.md` has one bullet in "Plugins and connectors" under Unreleased: a visitor gets the named person's grants, no local port listens, and a host with users and no person refuses with a word on the row.

Validation: the page was read against task-03's behaviour case by case. No suite was run, and no daemon or tunnel was started.

### Rewritten 2026-11-12, one tunnel is enough

Softov's change after task-05: the guide now teaches one tunnel, on 31546, with `person` or `requireToken`, so a reader never makes a second tunnel on the daemon's own port to get a public URL. The Answers table carries the row.

- The Options example is one tunnel with `person`, not the daemon's port, and points at [The tunnel kind](#the-tunnel-kind).
- "The tunnel kind" opens with the system tunnel on 31546 and the three ways in: `person` set, `requireToken` on with `?tkn=<token>`, and a host with users and neither set refusing the derived token. A host with no users needs no person.
- The four visitor cases that were in "The connection token" moved there and became those three, since the settings live there and the fourth case is the no-users one. That section now keeps the token mechanics and points back.
- One paragraph says a tunnel on another port forwards it as it is, and that an anonymous one to a port with no sign-in of its own is open to anyone with the URL. It is said once, in that section.
- "In VS Code" says which setting lets VS Code connect.
- The record JSON with the daemon's own port is gone, so nothing in the page suggests a second tunnel.
