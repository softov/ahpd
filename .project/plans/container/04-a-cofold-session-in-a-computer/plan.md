---
title: A cofold session in a computer runs in an ahpd started inside it
domain: container
status: built
priority: medium
created: 2026-09-26
revalidated: 2026-10-04
requires:
  - plans/plugin/14-cofold-runs-its-own-tools/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md
  - decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md
  - decisions/a-nested-session-resumes-its-inner-transcript-by-id.md
  - decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md
  - decisions/a-nested-host-is-configured-by-the-machine-profile-only.md
  - decisions/the-host-records-which-plugin-registered-each-agent.md
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L673](../../../../packages/agent-cofold/src/agent.ts#L673) - cofold's `runsNested: true`"
  - "[code://packages/sdk/src/nested.ts](../../../../packages/sdk/src/nested.ts) - the proxy: the nested host's stdio, the inner session, the mirror"
  - "[code://packages/sdk/src/host/spawn.ts#L332-L334](../../../../packages/sdk/src/host/spawn.ts#L332-L334) - the host gives a `runsNested` backend the proxy when its session names a computer"
  - "[code://packages/computer/src/plugin.ts#L634-L646](../../../../packages/computer/src/plugin.ts#L634-L646) - `nestedHost`, which starts the inner host through `reach`"
  - "[code://packages/sdk/src/types/computers.ts#L19-L143](../../../../packages/sdk/src/types/computers.ts#L19-L143) - `ComputerPort.how` and `Spawn`, a process in a machine"
  - "[code://packages/sdk/src/rpc.ts#L88](../../../../packages/sdk/src/rpc.ts#L88) - `createPeer`, a `Wire` over stdio"
  - "[code://packages/agent-acp/src/session.ts#L615](../../../../packages/agent-acp/src/session.ts#L615) - `placed()`, a backend that starts its process through the port"
  - "[code://packages/computer/src/devcontainer.ts#L481-L486](../../../../packages/computer/src/devcontainer.ts#L481-L486) - the relay's nested host started with `--stdio`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpClient`, the client the proxy uses
  - "git://7552054:.project/ideas/an-image-that-carries-ahpd.md - where the image goes next: one that carries ahpd, with only the code shared in"
---

## Goal

A cofold session created with `computer://<id>` runs inside that machine: an ahpd with the cofold plugin runs there, and the session looks to a client exactly like one on this host.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
createSession { provider: cofold, computer: X } -> [new] cofold runs nested -> proxy backend
  -> nested(X, plugins) = profile.host ?? ahpd, with --stdio --plugin @ahpd/agent-cofold -> a process with stdio
  -> AhpClient over it: initialize, createSession (no computer), subscribe
turn, confirm, cancel, config    -> [new] dispatched to the inner session
inner session actions            -> [new] emitted as the outer session's
process exits                    -> [new] the session ends with the stderr tail as its sentence
```

### Gaps

- The inner host's end is taken from `exit` and its stdin has no `error` listener ([`code://packages/sdk/src/nested.ts#L173`](../../../../packages/sdk/src/nested.ts#L173)), so a dead pipe can throw in the daemon.
- The stderr tail is twelve lines of any length ([`code://packages/sdk/src/nested.ts#L38`](../../../../packages/sdk/src/nested.ts#L38)), and stdout is rescanned from the start on every chunk.
- An ended nested session drops later actions silently, and inner chat URIs reach the client unchanged.
- The inner session has a random id ([`code://packages/sdk/src/nested.ts#L232`](../../../../packages/sdk/src/nested.ts#L232)), so a resume starts a blank session.
- Several members answer `true` whatever happened (`setConfig` at [`code://packages/sdk/src/nested.ts#L486`](../../../../packages/sdk/src/nested.ts#L486)); `models` and `awaiting` are always empty (`:411`, `:506`).
- The inner session is created at this host's path rather than the machine's.
- `close` sends `disposeSession` and kills the process in the same tick ([`code://packages/sdk/src/nested.ts#L511-L524`](../../../../packages/sdk/src/nested.ts#L511-L524)).
- The inner plugin is derived as `@ahpd/agent-${name}` ([`code://packages/sdk/src/nested.ts#L98`](../../../../packages/sdk/src/nested.ts#L98)), and `runsNested` is a boolean ([`code://packages/sdk/src/validate.ts#L69`](../../../../packages/sdk/src/validate.ts#L69), [`code://packages/sdk/src/types/agent.ts#L439`](../../../../packages/sdk/src/types/agent.ts#L439)).
- `packages/sdk/test/nested-process.test.ts` does not exist yet; every pipe behaviour is tested only against in-memory fakes.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A cofold session in a computer runs in an ahpd started inside it](../../../decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md) | 01, 04 |
| [A session reaches a nested host through a generic proxy backend in the SDK](../../../decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md) | 02, 03, 04 |
| [A nested session is resumed by resuming the inner transcript by id](../../../decisions/a-nested-session-resumes-its-inner-transcript-by-id.md) | 11 |
| [A nested host's image installs its plugins with ahpd plugin install](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) | 16 |
| [A nested host is configured by the machine's profile only](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md) | 17 |
| [The host records which plugin registered each agent, and a nested host loads that plugin](../../../decisions/the-host-records-which-plugin-registered-each-agent.md) | 17 |

| What | Source | Task |
| --- | --- | --- |
| The profile provides ahpd: its image or mounts carry it, and an optional `host` command says how to start it, default `ahpd` | Softov, 2026-09-26: "profile serves it.. command if desired and will be needed for kvm" | 01 |
| No install step; a machine without ahpd is refused with a sentence | follows from the profile providing it | 01, 05 |
| A backend opts in to the proxy by declaring `runsNested: true`; cofold does | the proxy is generic | 04, 17 |
| cofold's config reaches the machine as its declared need, at a fixed target | [decision](../../../decisions/cofold-config-reaches-a-machine-by-a-path-variable.md), `plugin/15` | 12 |
| A write to a dead inner host, or its stdin closing, is the session's end and never an uncaught error; the end is read from `close`, with the signal in the sentence | follows from "a failure is a sentence, never a hang" | 07 |
| The proxy is tested against a real child process as well as the in-memory fakes | the fakes cannot raise `EPIPE` or reorder `exit` and stdout | 07 |
| The inner session works at the path the session's folder is mounted at inside the machine | follows from the mount mapping `how` already applies | 14 |
| The proxy rewrites every inner chat URI to an outer one before it emits: the inner default chat becomes the session's `chatUri`, and any other inner chat an outer URI the proxy names and serves. | Softov, 2026-09-26: "the proxy rewrites them to outer ones". | 10 |
| A nested session whose inner host has ended refuses every later action and turn with the sentence it ended with; it neither hangs nor restarts the inner host. | Softov, 2026-09-26: "refuse later actions and turns with the reason (no hang, no restart)". | 09 |
| The inner session falls back to the single agent the inner host serves only when the outer agent is the plugin's default provider; a variant the inner host does not serve ends the session with a sentence naming it | (defaulted: a variant run as the plain agent would run `claude-openrouter` with `claude`'s endpoint and keys) | 17 |
| The real-process test hands the inner host an explicit env of `PATH`, `HOME` and the XDG directories only | (defaulted: a spread `process.env` lets the runner's environment decide what the inner host does) | 07 |
| The image's user has a writable `HOME` and `XDG_CONFIG_HOME` with no mount under them, and a read-only config directory ends the session with the inner host's `EACCES` sentence; the image build is checked by hand | (defaulted: Docker makes a bind target's parents root, and a nested ahpd exits with `EACCES` when it cannot make `$XDG_CONFIG_HOME/ahpd`) | 16 |
| The proxy implements a member only when it can report the inner session's real answer; the rest are left out so the host refuses them, and required members answer from the mirrored inner state. | Softov, 2026-09-26: "leave them out so the host refuses them honestly (no blind `true`)". | 12, 13 |
| An agent registered from a preset says so with `Agent.variant: true`, which Claude and ACP set on every preset and nobody sets on a built-in or a renamed default; the inner host's single agent stands in only for an agent without it | Softov, 2026-10-06, asked how a variant is told from a plugin's default: "Agent says it's a variant". | 17 |
| The outer host records a nested session in its own session store when it opens (provider, machine, inner session id, title), and lists and resumes it from that record after a restart without asking the machine | Softov, 2026-10-06, asked how a nested session is listed after a restart: "Outer host keeps a record". | 11 |
| The proxy serves the inner host's subagent chats as outer chats now: their rows, their actions and the links to them in chat content all carry outer URIs | Softov, 2026-10-06, asked whether inner subagent chats wait for a wider `Emit`: "Build now". | 10 |
| After a nested session ends, read/archived and terminal actions stay allowed; chat actions and `session/activeClientSet` are refused with its sentence | Softov, 2026-10-06, asked "should read/archived and terminal actions be refused too after the end?": "Keep them allowed", since archiving is how a person clears a dead session and a terminal is the session's | 09 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A computer can start a nested host](task-01-a-computer-starts-a-nested-host.md) | implemented | - |
| [02 - The proxy opens an inner session and forwards turns](task-02-the-proxy-forwards-turns.md) | implemented | 01 |
| [03 - The proxy forwards asks, config, cancel and the end](task-03-the-proxy-forwards-the-rest.md) | implemented | 02 |
| [04 - A backend that runs nested is proxied instead of refused](task-04-nested-instead-of-refused.md) | implemented | 03 |
| [05 - A nested start that fails says why](task-05-a-failed-start-says-why.md) | implemented | 04 |
| [06 - Docs](task-06-docs.md) | implemented | 05 |
| [07 - The inner host's pipes cannot crash the daemon](task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md) | implemented | 06 |
| [08 - The stderr tail and the stdout framing are bounded](task-08-the-stderr-tail-and-stdout-framing-are-bounded.md) | implemented | 07 |
| [09 - An ended nested session refuses what follows with the reason](task-09-an-ended-nested-session-refuses-with-the-reason.md) | implemented | 07 |
| [10 - Inner chat URIs are rewritten to the outer ones](task-10-inner-chat-uris-are-rewritten.md) | implemented | 07 |
| [11 - A nested session resumes the inner transcript by id](task-11-a-nested-session-resumes-by-id.md) | implemented | 09 |
| [12 - The proxy answers only what it knows](task-12-the-proxy-answers-only-what-it-knows.md) | implemented | 10 |
| [13 - Models, sign-in and the inner host's requests cross the proxy](task-13-models-sign-in-and-requests-cross-the-proxy.md) | implemented | 12 |
| [14 - The inner session works in the machine's directory](task-14-the-working-directory-is-the-machines.md) | implemented | 07 |
| [15 - Close waits for the inner session to be disposed](task-15-close-waits-for-the-inner-dispose.md) | implemented | 07 |
| [16 - The docs say how the image gets ahpd and what a nested session does](task-16-docs-for-the-fixes.md) | implemented | 11, 12, 13, 14, 15, 17 |
| [17 - A backend that runs nested names its plugin, and the inner host is configured by the profile only](task-17-a-backend-names-its-nested-plugin.md) | implemented | 06 |

## Risks and tradeoffs

- The inner host's protocol version must be the outer's; the proxy refuses a mismatch at `initialize`.
- Every frame takes one more hop.
- A resume depends on the machine keeping the inner transcript; a disposable machine that has gone makes it a sentence.
- The image carries ahpd and its plugins until an image that carries ahpd (`git://7552054:.project/ideas/an-image-that-carries-ahpd.md`) exists.

## Resume state

- **Done so far:** tasks 01 to 06 implemented on 2026-09-26; tasks 07 to 17 implemented on 2026-10-06, as [implemented.md](implemented.md) says.
- **Done in the fix turn (2026-10-06):** Softov's three answers, in the table above, are built: `Agent.variant`, the nested session record, and inner subagent chats served outside.
- **Next action:** Softov's review, and the open question in [implemented.md](implemented.md) about read, archive and terminal actions on an ended session.
- **Watch out for:** a failure must end the session with a sentence and never hang or throw; a pipe or process behaviour is proved in `packages/sdk/test/nested-process.test.ts` against a real child. The inner host's protocol version must be the outer's; it is refused at `initialize`. An action a future protocol adds is forwarded without being mirrored rather than ending the session.

## Final verification checklist

- [ ] A cofold session on `computer://lulu` runs `hostname` and answers with the machine's name.
- [ ] An edit made there shows as a change in VS Code, and a permission ask is answered from VS Code.
- [ ] A machine without ahpd, or without cofold's config, refuses with a sentence.
- [ ] A cofold session on a machine whose inner host is killed mid-turn ends with a sentence, and the next turn is refused with it; the outer daemon keeps running.
- [ ] VS Code shows no chat the outer host does not serve after a turn in a nested session.
- [ ] A nested session resumed after the outer daemon restarts shows its earlier turns.
- [ ] A session in a folder mounted at another path inside the machine works in the inside path.
- [ ] A cofold registered under another provider name runs nested with `@ahpd/agent-cofold` loaded inside, and the machine's cofold configuration is the one it uses.
- [x] The image built from `docs/COMPUTER.md`'s example starts `ahpd --stdio --plugin @ahpd/agent-cofold`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
