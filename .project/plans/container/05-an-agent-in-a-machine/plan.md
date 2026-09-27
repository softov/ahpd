---
title: An agent in a machine is built once, started fast, and reached from anywhere
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
  - plans/plugin/16-a-disposable-machine/plan.md
  - plans/container/04-a-cofold-session-in-a-computer/plan.md
changes: []
creates: []
decisions:
  - decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/any-ahpd-can-be-the-hub.md
  - decisions/the-published-image-is-the-parts-joined.md
  - decisions/an-agent-cli-is-pinned-in-one-versions-file.md
refs:
  - "[code://packages/computer/src/runtime.ts#L625-L650](../../../../packages/computer/src/runtime.ts#L625-L650) - how a docker machine is made today: image, bind mounts, `-e KEY=VALUE`"
  - "[code://packages/computer/src/plugin.ts#L380-L408](../../../../packages/computer/src/plugin.ts#L380-L408) - how a command enters a machine: `docker exec -i -e KEY=VALUE`"
  - "[code://packages/sdk/src/types/machine.ts](../../../../packages/sdk/src/types/machine.ts) - the four need kinds an agent declares"
  - "[code://packages/agent-claude/src/claude.ts#L397-L406](../../../../packages/agent-claude/src/claude.ts#L397-L406) - Claude's CLI is the host's own binary, mounted"
  - "[code://packages/agent-acp/src/plugin.ts#L61-L86](../../../../packages/agent-acp/src/plugin.ts#L61-L86) - an ACP spec is a command, args and env, and declares no needs"
  - "[code://packages/sdk/src/host.ts#L4093-L4117](../../../../packages/sdk/src/host.ts#L4093-L4117) - `placedIn`, which hands the session's folder, already its worktree, to the machine maker"
  - "[code://packages/sdk/src/nested.ts#L95-L120](../../../../packages/sdk/src/nested.ts#L95-L120) - the proxy that relays a host started inside a machine"
  - "[code://.project/ideas/an-image-that-carries-ahpd.md](../../../ideas/an-image-that-carries-ahpd.md) - the image Softov asked for, which the parts answer"
  - "[code://.project/ideas/more-computer-runtimes.md](../../../ideas/more-computer-runtimes.md) - the ssh runtime and working without a mount"
---

## Goal

An agent runs in a machine with nothing installed at session start and nothing taken from the host user's home.
Every agent CLI, and ahpd itself, is built once into a part at a pinned version and reused by every machine on the host; a session's machine gets only the parts its agent needs, whatever its base image.
An agent's configuration lives in a volume per profile, its secret arrives by name, and its worktree arrives with the repository it belongs to.
The same session can then run on a Docker on another box, over ssh, or on a host that joined this one, because the inside of a machine is always reached through one stream.

This is the ground the next agents and plugins stand on, so it goes before them.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "'-e'" packages/computer/src` - a secret is written into argv in two places, `plugin.ts:394` and `runtime.ts:635`, and as `--remote-env` in two more.
- `rg "machine\(" packages/*/src` - Claude and cofold declare needs; agent-acp declares none.
- `rg "isolation" packages/sdk/src/host.ts` - the host already makes a worktree per session and passes it to `placedIn` as the folder.

### Runtime path

```
profile -> [p3] versions.json -> part images, built on first use
session start -> placedIn(folder = worktree) -> agent.machine() [p2, p5: parts, config env, secret names]
  -> docker run: image mounts [p4], state volume [p6], worktree + repository .git [p7], env by name [p1]
  -> how(): docker exec -e NAME  |  nested(): a host inside [p8, p9, p10 for other hosts]
```

### Gaps

- A secret sits in the host's process list as `-e KEY=VALUE`.
- An ACP agent cannot say what its machine needs; signing in is [acp 04](../../acp/04-the-bridge-signs-in/plan.md).
- No agent CLI is built by ahpd; Claude's is the host's binary.
- A disposable machine pays every copy-in again.
- A worktree mounted alone has a `.git` file pointing at a repository the machine cannot see.
- Nothing reaches a machine that is not on this host.

## Decisions locked in

| Decision | Plans |
| --- | --- |
| [A part is mounted from its own image, and a volume filled from that image is the fallback](../../../decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md) | p4 |
| [A nested host is used only for a backend that runs nested and for a machine on another host](../../../decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md) | p5, p8, p9, p10 |
| [Any ahpd can be the hub other hosts join](../../../decisions/any-ahpd-can-be-the-hub.md) | p10 |
| [The image ahpd publishes is its parts joined, and there is no other base](../../../decisions/the-published-image-is-the-parts-joined.md) | p3 |
| [Every agent CLI is pinned in one versions file, and none updates itself](../../../decisions/an-agent-cli-is-pinned-in-one-versions-file.md) | p3 |

| What | Source | Plans |
| --- | --- | --- |
| One child plan per package scope, done before more agents and plugins | Softov, 2026-09-26: "clear steps.. separated by scope. package. before we do more agents and plugins" | all |
| The host-home mounts stay as an explicit opt-in, and stop being the default | the proposal Softov asked to plan, 2026-09-26 | p5, p6 |
| Local steps are planned now; the remote steps stay drafts until the local ones are built | (defaulted: the remote steps depend on p5's ahpd part) | p8, p9, p10 |

## Proposed architecture

- **Data flow** - a profile names a base image and, for a long-lived machine, its parts; an agent's `machine()` names its part, its config dir variable, its seeded files and its secret names; the computer plugin turns that into image mounts, a state volume, the worktree and repository mounts, and env by name.
- **State flow** - parts are images tagged by version, state volumes are named by profile and agent, and neither is lost with a machine.
- **Layer responsibilities** - `@ahpd/sdk`: the part and state need kinds, and the folder plus git directory handed to a machine maker · `@ahpd/computer`: the versions file, the part builds, the runtime flags, and every runtime · `@ahpd/agent-acp`, `@ahpd/agent-claude`, `@ahpd/agent-cofold`, `@ahpd/agent-pi`: what each agent needs · `@ahpd/server`: `ahpd join`.
- **Source-of-truth files** - [`code://packages/sdk/src/types/machine.ts`](../../../../packages/sdk/src/types/machine.ts), [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts), and `packages/computer/images/versions.json` once p3 makes it.

## Tasks

Child plans, each scoped to one package or two.

| Plan | Package | Status | Depends on |
| --- | --- | --- | --- |
| [p1 - A secret reaches a machine by name](../05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md) | computer | planned | - |
| [p2 - An ACP spec says what its machine needs](../05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md) | agent-acp | planned | p1 |
| [p3 - Parts are built from one versions file](../05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md) | computer (images) | planned | - |
| [p4 - A part is mounted into a machine](../05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md) | sdk, computer | planned | p3 |
| [p5 - Agents run from their parts and keep their own state](../05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md) | agent-claude, agent-acp, agent-cofold, agent-pi | planned | p2, p4, p6, acp 05 |
| [p6 - An agent's configuration lives in a volume per profile](../05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/plan.md) | sdk, computer | planned | - |
| [p7 - A worktree reaches its machine with its repository](../05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md) | sdk, computer | planned | - |
| [p8 - A profile's machines may live on another Docker](../05-an-agent-in-a-machine-p8-a-profile-on-another-docker/plan.md) | computer | draft | p5, p7 |
| [p9 - An ssh machine runs a nested host](../05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md) | computer, sdk | draft | p5 |
| [p10 - A host joins another, which relays its sessions](../05-an-agent-in-a-machine-p10-a-host-joins-a-hub/plan.md) | server, sdk | draft | p9 |

## Risks and tradeoffs

- Image mounts are experimental in Docker 29 - the volume fallback is built in p4, and its test runs without image mount support.
- Parts are read-only - an agent that writes beside its binary is pointed at its config dir by its preset.
- Plugin 15 and 16 still have fix tasks open - p4, p6 and p7 change the same files, so those fix tasks land first.

## Resume state

- **Done so far:** nothing; planned 2026-09-26.
- **Next action:** finish plugin 15 and 16's fix tasks, then p1 and p3, which do not depend on each other.
- **Open questions:** none for the planned children; the drafts carry their own.
- **Watch out for:** no child cites another project; the fake Docker in `packages/computer/test/fixtures/docker.mjs` has to learn every new flag before a test can hold it.

## Final verification checklist

- [ ] A disposable Codex session runs in `debian:bookworm-slim` with nothing installed in the image and nothing mounted from the host's home.
- [ ] `ps` on the host shows no secret value while a machine runs.
- [ ] A second disposable machine of the same profile starts without building or copying anything.
- [ ] A session with worktree isolation commits inside its machine.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `docs/PLUGINS.md` and `plans/index.md` updated.
