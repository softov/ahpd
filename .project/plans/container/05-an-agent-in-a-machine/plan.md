---
title: An agent in a machine is built once, started fast, and reached from anywhere
domain: container
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-10-03
requires:
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
  - plans/plugin/16-a-disposable-machine/plan.md
  - plans/container/04-a-cofold-session-in-a-computer/plan.md
  - plans/container/03-a-dev-container-is-a-computer/plan.md
  - plans/claude/15-one-load-and-each-preset-is-a-variant/plan.md
changes: []
creates: []
decisions:
  - decisions/a-part-is-mounted-from-its-image-and-a-volume-is-the-fallback.md
  - decisions/a-nested-host-is-used-only-where-a-command-cannot-reach-the-agent.md
  - decisions/any-ahpd-can-be-the-hub.md
  - decisions/the-published-image-is-the-parts-joined.md
  - decisions/an-agent-cli-is-pinned-in-one-versions-file.md
  - decisions/a-dev-container-is-reached-by-docker-exec.md
  - decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md
  - decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md
refs:
  - "[code://packages/computer/src/runtime.ts#L697-L746](../../../../packages/computer/src/runtime.ts#L697-L746) - how a docker machine is made today: image, labels (owner, team and project among them), bind mounts, `-e KEY=VALUE`"
  - "[code://packages/computer/src/plugin.ts#L562-L620](../../../../packages/computer/src/plugin.ts#L562-L620) - how a command enters a machine: `docker exec -i -e KEY=VALUE` (L606), or `devcontainer exec` for a dev container until container/03 switches it"
  - "[code://packages/sdk/src/types/machine.ts#L74-L78](../../../../packages/sdk/src/types/machine.ts#L74-L78) - the four need kinds an agent declares"
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - Claude's needs: the host's `~/.claude` and its own binary, mounted"
  - "[code://packages/agent-acp/src/plugin.ts#L35-L61](../../../../packages/agent-acp/src/plugin.ts#L35-L61) - an ACP load is one command, args and env, registers one agent, and declares no needs"
  - "[code://packages/sdk/src/host.ts#L5304-L5334](../../../../packages/sdk/src/host.ts#L5304-L5334) - `placedIn`, which hands the session's folder, already its worktree, and its provider's `machine()` to the machine maker"
  - "[code://packages/sdk/src/nested.ts#L95-L129](../../../../packages/sdk/src/nested.ts#L95-L129) - the proxy that relays a host started inside a machine"
  - "git://7552054:.project/ideas/an-image-that-carries-ahpd.md - the image Softov asked for, which the parts answer"
  - "[code://.project/ideas/more-computer-runtimes.md](../../../ideas/more-computer-runtimes.md) - the runtimes not planned, and copying a folder that is not a repository"
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

- `rg "'-e'|--remote-env" packages/computer/src` - a secret is written into argv as `-e` at `plugin.ts:606` and `runtime.ts:731`, and as `--remote-env` at `plugin.ts:579` and `runtime.ts:674`.
- `rg "machine\(" packages/*/src` - Claude and cofold declare needs; agent-acp and agent-pi declare none.
- `rg "PartNeed|StateNeed|gitDir|images/" packages/*/src` - nothing of this plan is built.
- `rg "isolation" packages/sdk/src/host.ts` - the host already makes a worktree per session and passes it to `placedIn` as the folder.

### Runtime path

```
profile -> [p3] versions.json -> part images, built on first use
session start -> placedIn(folder = worktree, owner, team, project) -> the variant's machine() [p2, p5: parts, config env, secrets]
  -> docker run (or devcontainer up): image mounts [p4], state volume [p6], worktree + repository .git [p7], env by name [p1]
  -> how(): docker exec -e NAME  |  nested(): a host inside [p8, p9, p10 for other hosts]
```

### Gaps

- A secret sits in the host's process list as `-e KEY=VALUE`.
- An ACP agent cannot say what its machine needs, and agent-acp has no presets to hang a machine block on until [acp/05](../../acp/05-presets/plan.md) is rewritten to agent-claude's shape; signing in is [acp 04](../../acp/04-the-bridge-signs-in/plan.md), built 2026-10-02.
- A need value in the computer plugin's options is plain text in root config.
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
| [A dev container is made by the Dev Container CLI and reached by docker exec](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) | p1, p4 |
| [A plugin is loaded once, and each of its presets is a variant registered as an agent of its own](../../../decisions/a-plugin-loads-once-and-each-preset-is-a-variant.md) | p2, p5, p6 |
| [Secrets live in a vault port, and the host's own vault is a plain file until it is encrypted](../../../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md) | p1, p2 |

| What | Source | Plans |
| --- | --- | --- |
| One child plan per package scope, done before more agents and plugins | Softov, 2026-09-26: "clear steps.. separated by scope. package. before we do more agents and plugins" | all |
| The host-home mounts stay as an explicit opt-in, and stop being the default | the proposal Softov asked to plan, 2026-09-26 | p5, p6 |
| A remote step (p8 to p12) is planned once its open questions are answered, and is built after the local steps, since it depends on p5's ahpd part | Softov, 2026-10-03, on p11 and p12: "may move from draft to planned" once nothing else is open | p8, p9, p10, p11, p12 |
| A machine block belongs to a preset, since each preset registers its own agent and the host asks the session's own provider for `machine()` | [code://packages/sdk/src/host.ts#L5321-L5330](../../../../packages/sdk/src/host.ts#L5321-L5330) and the variant decision above | p2, p5, p6 |
| This plan delivers a secret; the vault plan, [vault/01](../../vault/01-secrets-live-in-a-vault/plan.md), resolves a `{ "$secret" }` and claude/12's `{ "fromEnv" }` stays the cheaper route | Softov, 2026-10-02, asked "What does the vault unlock first?": "Options and machines" | p1, p2 |

## Proposed architecture

- **Data flow** - a profile names a base image and, for a long-lived machine, its parts; each registered agent, one per preset, answers `machine()` with its part, its config dir variable, its seeded files and its secrets; the computer plugin turns that into image mounts, a state volume, the worktree and repository mounts, and env by name.
- **State flow** - parts are images tagged by version, state volumes are named by profile and provider (a preset's key), and neither is lost with a machine.
- **Layer responsibilities** - `@ahpd/sdk`: the part and state need kinds, and the folder plus git directory handed to a machine maker · `@ahpd/computer`: the versions file, the part builds, the runtime flags, and every runtime · `@ahpd/agent-acp`, `@ahpd/agent-claude`, `@ahpd/agent-cofold`, `@ahpd/agent-pi`: what each agent needs · `@ahpd/server`: `ahpd join`.
- **Source-of-truth files** - [`code://packages/sdk/src/types/machine.ts`](../../../../packages/sdk/src/types/machine.ts), [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts), and `packages/computer/images/versions.json` once p3 makes it.

## Tasks

Child plans, each scoped to one package or two.

| Plan | Package | Status | Depends on |
| --- | --- | --- | --- |
| [p1 - A secret reaches a machine in its environment, never in its argv](../05-an-agent-in-a-machine-p1-a-secret-reaches-a-machine-by-name/plan.md) | computer | planned | container 03 |
| [p2 - An ACP preset says what its machine needs](../05-an-agent-in-a-machine-p2-an-acp-agent-says-what-its-machine-needs/plan.md) | agent-acp | planned | p1, acp 05 (the ACP presets plan) |
| [p3 - Parts are built from one versions file](../05-an-agent-in-a-machine-p3-parts-are-built-from-one-versions-file/plan.md) | computer (images) | planned | - |
| [p4 - A part is mounted into a machine](../05-an-agent-in-a-machine-p4-a-part-is-mounted-into-a-machine/plan.md) | sdk, computer | planned | p3, plugin 15, container 03 |
| [p5 - Agents run from their parts and keep their own state](../05-an-agent-in-a-machine-p5-agents-run-from-their-parts/plan.md) | agent-claude, agent-acp, agent-cofold, agent-pi | planned | p2, p4, p6, acp 05 (the ACP presets plan) |
| [p6 - An agent's configuration lives in a volume per profile](../05-an-agent-in-a-machine-p6-an-agents-configuration-lives-in-a-volume/plan.md) | sdk, computer | planned | - |
| [p7 - A worktree reaches its machine with its repository](../05-an-agent-in-a-machine-p7-a-worktree-brings-its-repository/plan.md) | sdk, computer | planned | plugin 16 |
| [p8 - A profile's machines may live on another Docker](../05-an-agent-in-a-machine-p8-a-profile-on-another-docker/plan.md) | computer | planned | p5, p7, p9, p12 |
| [p9 - An ssh machine runs a nested host](../05-an-agent-in-a-machine-p9-an-ssh-machine-runs-a-nested-host/plan.md) | computer, sdk | planned | container 04 (tasks 11, 14, 15, 17) |
| [p10 - A host joins another, which relays its sessions](../05-an-agent-in-a-machine-p10-a-host-joins-a-hub/plan.md) | server, sdk | planned | p9, p12, daemon 13 |
| [p11 - A virtual machine is made for a computer, by libvirt and then by Proxmox](../05-an-agent-in-a-machine-p11-a-vm-is-made-for-a-machine/plan.md) | computer | planned | p3, p5, p8, p9, p12 |
| [p12 - A machine off this host reaches its models through this host's proxy](../05-an-agent-in-a-machine-p12-a-machine-off-this-host-reaches-models-through-the-proxy/plan.md) | sdk, computer, server | planned | p9, claude 16, the proxy listener plan (not written yet) |

## Risks and tradeoffs

- Image mounts are experimental in Docker 29 - the volume fallback is built in p4, and its test runs without image mount support.
- Parts are read-only - an agent that writes beside its binary is pointed at its config dir by its preset.
- Plugin 15 and 16 still have fix tasks open - p4, p6 and p7 change the same files, so those fix tasks land first.
- acp/05 assumes one spec per ACP backend - p2 and p5 build on it only once it is rewritten to agent-claude's shape, one load with a `presets` map.
- container/03 switches dev containers to `docker exec` - p1 leaves the `devcontainer exec` writer to that switch, and p4's dev container parts wait for it.

## Resume state

- **Done so far:** nothing; planned 2026-09-26, revalidated against main 2026-10-02 after claude/15 landed.
- **Next action:** finish plugin 15 and 16's fix tasks, then p1 and p3, which do not depend on each other; p5 task 09 needs nothing else.
- **Open questions:** each child carries its own in its Resume state, each marked with the task it must be asked before; p2 and p5 also wait for acp/05, rewritten as the ACP presets plan, which ships presets for the known agents; p12 waits for a proxy listener plan that does not exist yet.
- **Watch out for:**
  - No child cites another project.
  - Most answers recorded in the children on 2026-10-03 are current choices for fast development, not decisions: each is made in one function or option named in its row, so it can change without a new decision.
  - A machine id is spelled and parsed only by p9 task 01's functions; p8, p10 and p11 use them.
  - The fake Docker in `packages/computer/test/fixtures/docker.mjs` has to learn every new flag before a test can hold it.

## Final verification checklist

- [ ] A disposable Codex session runs in `debian:bookworm-slim` with nothing installed in the image and nothing mounted from the host's home (waits on acp/05, the ACP presets plan, which gives Codex a preset).
- [ ] `ps` on the host shows no secret value while a machine runs.
- [ ] A second disposable machine of the same profile starts without building or copying anything.
- [ ] A session with worktree isolation commits inside its machine.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/COMPUTER.md`, `docs/PLUGINS.md` and `plans/index.md` updated.
