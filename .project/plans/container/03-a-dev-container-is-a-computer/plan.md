---
title: A dev container is a computer, listed and reachable without the connection that made it
domain: container
status: draft
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/container/01-a-session-in-a-dev-container/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/sdk/src/host.ts#L4987](../../../../packages/sdk/src/host.ts#L4987) - `containers`, the relays a connection opened, kept in `accept`'s closure and dropped with the socket"
  - "[code://packages/computer/src/runtime.ts#L272](../../../../packages/computer/src/runtime.ts#L272) - `list`, which finds machines by the `ahpd.computer=1` label only"
  - "[code://packages/computer/src/plugin.ts#L297-L321](../../../../packages/computer/src/plugin.ts#L297-L321) - the `computer` session key and the picker it answers"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the launcher that runs `devcontainer up` and the host inside"
  - "[code://.project/decisions/a-dev-container-is-made-by-the-dev-container-cli.md](../../../decisions/a-dev-container-is-made-by-the-dev-container-cli.md) - why the two mechanisms were kept apart, which this plan revisits"
  - "[code://.project/ideas/an-agent-says-what-a-machine-needs.md](../../../ideas/an-agent-says-what-a-machine-needs.md) - what a backend needs mounted in any machine, a dev container included"
---

## Goal

A dev container this host made is a computer: it shows in the computer picker and on the host's computers list, a session can be created in it by `computer://`, and it stays there when the connection that made it drops or the client reloads.
The reference relay stays, so VS Code's own flow works unchanged.
Source: Softov, 2026-09-26, chose option B, "a dev container is a kind of computer", after a container made from ahpapp vanished on reload and did not show as a computer.

## Reconnaissance

### Searches performed

- `rg -n "const containers = new Map" packages/sdk/src/host.ts` - relay state lives per connection, so a dropped socket ends the relay while the container and the host inside it keep running.
- `rg -n "label=" packages/computer/src/runtime.ts` - computers are found by one Docker label; the Dev Container CLI labels its containers `devcontainer.local_folder` and `devcontainer.config_file` instead.

### Gaps

- A container made by `devcontainer up` has no `ahpd.computer=1` label, so it is not listed.
- The relay dies with the connection; nothing reattaches to the host already running inside.
- The `00-container.md` text and decision `a-dev-container-is-made-by-the-dev-container-cli` say the two are kept apart, which this plan changes.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| A dev container is a kind of computer, and the reference relay is kept | Softov, 2026-09-26: "I did go for B" | - |

## Tasks

Written once the open questions are answered.

## Risks and tradeoffs

- A container listed as a computer is reached two ways, by the relay and by `docker exec`; a session must say which one it runs through.
- `devcontainer.json` can set a user, mounts and lifecycle commands that `docker exec` does not replay; the CLI's `exec` does.

## Resume state

- **Done so far:** the goal and the gaps, 2026-09-26.
- **Next action:** answer the open questions, then write the decisions and tasks.
- **Open questions:**
  1. How a dev container becomes a computer - proposed: the computer runtime also lists containers with a `devcontainer.local_folder` label, named from the folder, and reaches them through `devcontainer exec` so the config's user and environment apply.
  2. Whether a session in a dev container runs through the host inside it (container/01) or through `computer://` with the backend outside - proposed: both stay; `computer://` is the route for backends that already move (acp, claude), the relay for the rest.
  3. Whether the computer form can make one from a folder - proposed: yes, a "from devcontainer.json" choice that runs `devcontainer up` and nothing else.
  4. Whether a dropped relay can reattach to the host already inside - proposed: `connect` for the same folder finds the running inner host and relays to it, instead of starting another.
- **Watch out for:** the machine-needs idea applies here too; a dev container has none of the host user's Claude or cofold config unless something mounts it, which is why cofold hung in one.

## Final verification checklist

- [ ] A dev container made from ahpapp shows in the computer picker and on the computers list.
- [ ] A session created with that `computer://` runs in it.
- [ ] After an ahpapp reload the container is still listed and its session continues.
- [ ] VS Code's flow still works through the relay.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `plans/index.md` updated.
