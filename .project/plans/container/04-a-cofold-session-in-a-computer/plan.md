---
title: A cofold session in a computer runs in an ahpd started inside it
domain: container
status: active
priority: medium
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/14-cofold-runs-its-own-tools/plan.md
  - plans/plugin/15-an-agent-says-what-a-machine-needs/plan.md
changes: []
creates: []
decisions:
  - decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md
  - decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md
  - decisions/a-nested-sessions-chat-uris-are-the-outer-ones.md
  - decisions/a-nested-session-whose-host-ended-refuses-with-the-reason.md
  - decisions/a-nested-session-resumes-its-inner-transcript-by-id.md
  - decisions/the-nested-proxy-leaves-out-what-it-cannot-forward.md
  - decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md
  - decisions/a-nested-host-is-configured-by-the-machine-profile-only.md
  - decisions/a-backend-that-runs-nested-names-its-plugin.md
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L605](../../../../packages/agent-cofold/src/agent.ts#L605) - `refuseComputer`, the answer today"
  - "[code://packages/sdk/src/computers.ts](../../../../packages/sdk/src/computers.ts) - `refuseComputer` and how a backend opens its computer"
  - "[code://packages/sdk/src/types/computers.ts#L16-L49](../../../../packages/sdk/src/types/computers.ts#L16-L49) - `ComputerPort.how` and `Spawn`, a process in a machine"
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../../../packages/sdk/src/rpc.ts#L74-L100) - `createPeer`, a `Wire` over stdio"
  - "[code://packages/agent-acp/src/session.ts#L447-L479](../../../../packages/agent-acp/src/session.ts#L447-L479) - `placed()`, a backend that starts its process through the port"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts) - the nested host started with `--stdio`"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpClient`, the client the proxy uses
  - "[code://.project/ideas/an-image-that-carries-ahpd.md](../../../ideas/an-image-that-carries-ahpd.md) - where the image goes next: one that carries ahpd, with only the code shared in"
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

- Nothing in the SDK speaks AHP as a client.
- A backend that cannot move refuses a computer; nothing chooses a proxy instead.
- A nested host is started only by the dev container launcher.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [A cofold session in a computer runs in an ahpd started inside it](../../../decisions/a-cofold-session-in-a-computer-runs-in-a-nested-host.md) | 01, 04 |
| [A session reaches a nested host through a generic proxy backend in the SDK](../../../decisions/a-session-reaches-a-nested-host-through-a-generic-proxy.md) | 02, 03, 04 |
| [A nested session's chat URIs are rewritten to the outer ones](../../../decisions/a-nested-sessions-chat-uris-are-the-outer-ones.md) | 10 |
| [A nested session whose host ended refuses what follows with the reason](../../../decisions/a-nested-session-whose-host-ended-refuses-with-the-reason.md) | 09 |
| [A nested session is resumed by resuming the inner transcript by id](../../../decisions/a-nested-session-resumes-its-inner-transcript-by-id.md) | 11 |
| [The nested proxy leaves out what it cannot forward](../../../decisions/the-nested-proxy-leaves-out-what-it-cannot-forward.md) | 12, 13 |
| [A nested host's image installs its plugins with ahpd plugin install](../../../decisions/a-nested-host-image-installs-its-plugins-with-ahpd-plugin-install.md) | 16 |
| [A nested host is configured by the machine's profile only](../../../decisions/a-nested-host-is-configured-by-the-machine-profile-only.md) | 17 |
| [A backend that runs nested names the plugin the inner host loads](../../../decisions/a-backend-that-runs-nested-names-its-plugin.md) | 17 |

| What | Source | Task |
| --- | --- | --- |
| The profile provides ahpd: its image or mounts carry it, and an optional `host` command says how to start it, default `ahpd` | Softov, 2026-09-26: "profile serves it.. command if desired and will be needed for kvm" | 01 |
| No install step; a machine without ahpd is refused with a sentence | follows from the profile providing it | 01, 05 |
| A backend opts in to the proxy by declaring `runsNested: { plugin }`; cofold does | the proxy is generic | 04, 17 |
| cofold's config reaches the machine as its declared need, at a fixed target | [decision](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md), `plugin/15` | 12 |
| A write to a dead inner host, or its stdin closing, is the session's end and never an uncaught error; the end is read from `close`, with the signal in the sentence | follows from "a failure is a sentence, never a hang" | 07 |
| The proxy is tested against a real child process as well as the in-memory fakes | the fakes cannot raise `EPIPE` or reorder `exit` and stdout | 07 |
| The inner session works at the path the session's folder is mounted at inside the machine | follows from the mount mapping `how` already applies | 14 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A computer can start a nested host](task-01-a-computer-starts-a-nested-host.md) | implemented | - |
| [02 - The proxy opens an inner session and forwards turns](task-02-the-proxy-forwards-turns.md) | implemented | 01 |
| [03 - The proxy forwards asks, config, cancel and the end](task-03-the-proxy-forwards-the-rest.md) | implemented | 02 |
| [04 - A backend that runs nested is proxied instead of refused](task-04-nested-instead-of-refused.md) | implemented | 03 |
| [05 - A nested start that fails says why](task-05-a-failed-start-says-why.md) | implemented | 04 |
| [06 - Docs](task-06-docs.md) | implemented | 05 |
| [07 - The inner host's pipes cannot crash the daemon](task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md) | todo | 06 |
| [08 - The stderr tail and the stdout framing are bounded](task-08-the-stderr-tail-and-stdout-framing-are-bounded.md) | todo | 07 |
| [09 - An ended nested session refuses what follows with the reason](task-09-an-ended-nested-session-refuses-with-the-reason.md) | todo | 07 |
| [10 - Inner chat URIs are rewritten to the outer ones](task-10-inner-chat-uris-are-rewritten.md) | todo | 07 |
| [11 - A nested session resumes the inner transcript by id](task-11-a-nested-session-resumes-by-id.md) | todo | 09 |
| [12 - The proxy answers only what it knows](task-12-the-proxy-answers-only-what-it-knows.md) | todo | 10 |
| [13 - Models, sign-in and the inner host's requests cross the proxy](task-13-models-sign-in-and-requests-cross-the-proxy.md) | todo | 12 |
| [14 - The inner session works in the machine's directory](task-14-the-working-directory-is-the-machines.md) | todo | 07 |
| [15 - Close waits for the inner session to be disposed](task-15-close-waits-for-the-inner-dispose.md) | todo | 07 |
| [16 - The docs say how the image gets ahpd and what a nested session does](task-16-docs-for-the-fixes.md) | todo | 11, 12, 13, 14, 15, 17 |
| [17 - A backend that runs nested names its plugin, and the inner host is configured by the profile only](task-17-a-backend-names-its-nested-plugin.md) | todo | 06 |

## Risks and tradeoffs

- The inner host's protocol version must be the outer's; the proxy refuses a mismatch at `initialize`.
- Every frame takes one more hop.
- A resume depends on the machine keeping the inner transcript; a disposable machine that has gone makes it a sentence.
- The image carries ahpd and its plugins until [an image that carries ahpd](../../../ideas/an-image-that-carries-ahpd.md) exists.

## Resume state

- **Done so far:** tasks 01 to 06 implemented on 2026-09-26: the computers port starts a nested host, `packages/sdk/src/nested.ts` is the proxy, `Agent.runsNested` chooses it, cofold declares it, and `docs/COMPUTER.md` explains it.
- **Next action:** [task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md](task-07-the-inner-hosts-pipes-cannot-crash-the-daemon.md), which also builds the real-process test the later tasks use.
- **Open questions:** none.
- **Watch out for:** a failure must end the session with a sentence and never hang or throw; the in-memory fakes in `test/nested-proxy.test.ts` hid an `EPIPE` crash, so a pipe or process behaviour is proved in `test/nested-process.test.ts` against a real child. The inner host's protocol version must be the outer's; it is refused at `initialize`. An action a future protocol adds is forwarded without being mirrored rather than ending the session.

## Final verification checklist

- [ ] A cofold session on `computer://lulu` runs `hostname` and answers with the machine's name.
- [ ] An edit made there shows as a change in VS Code, and a permission ask is answered from VS Code.
- [ ] A machine without ahpd, or without cofold's config, refuses with a sentence.
- [ ] A cofold session on a machine whose inner host is killed mid-turn ends with a sentence, and the next turn is refused with it; the outer daemon keeps running.
- [ ] VS Code shows no chat the outer host does not serve after a turn in a nested session.
- [ ] A nested session resumed after the outer daemon restarts shows its earlier turns.
- [ ] A session in a folder mounted at another path inside the machine works in the inside path.
- [ ] A cofold registered under another provider name runs nested with `@ahpd/agent-cofold` loaded inside, and the machine's cofold configuration is the one it uses.
- [ ] The image built from `docs/COMPUTER.md`'s example starts `ahpd --stdio --plugin @ahpd/agent-cofold`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green; `docs/COMPUTER.md`, `plans/index.md` updated.
