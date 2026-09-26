---
title: An agent says what a machine needs to run it
created: 2026-09-26
---

A Claude session in a computer works today only because a profile in the computer plugin's options lists three host paths by hand: `~/.claude`, `~/.claude.json` and the CLI binary. The binary path carried a version (`versions/2.1.267`, copied from the `docs/COMPUTER.md` example), so on a host with another version Docker created an empty directory in its place and the session exited 127. The knowledge of what Claude needs lives in the wrong plugin, and a missing mount source fails silently.

The agent should say what it needs, and whatever makes the machine should supply it. agent-claude would declare named needs, each with a type, where it goes in the machine, whether it is read-only, and a default it resolves itself:

```ts
claudeConfigDirectory: { type: 'directory', mountPoint: '/ahpd/claude', default: '~/.claude', required: true },
claudeConfigJson:      { type: 'file', mountPoint: '/ahpd/claude/.claude.json', default: '~/.claude.json', required: true },
claudeExecutable:      { type: 'file', mountPoint: '/usr/local/bin/claude', readOnly: true, default: '<what ~/.local/bin/claude points at, or the SDK binary>' },
```

A need is delivered as a mount, an environment variable or a file copied in, so a runtime that cannot bind-mount a host path (a VM) still has a way. A profile names the agents it prepares a machine for (`"agents": ["claude"]`) instead of listing their mounts. Each need is filled from the profile, then the plugin option, then the agent's default, and the runtime turns the result into its own flags. The machine remembers which agents it was prepared for, and a session that picks an agent on a machine not prepared for it is refused with a sentence rather than a 127. A mount whose host path does not exist is refused at create, whatever the source.

## What Softov settled so far (2026-09-26)

- **The defaults come from the host's user folder.** That is where the subscription sign-in (`.credentials.json`), `settings.json` and the rest of the configuration live, and it has to come from somewhere. The intent is one Claude per host: for personal use that is one folder, and for a company it is shared for now. Where that sharing matters, the docs warn about it while this is refined. Isolation of memory per person would be a different mechanism, probably files copied in rather than a mounted folder.
- **Setup could let the person pick those paths**, instead of the host assuming `~`.
- **Mounts, env and copy-in** are all needed as delivery kinds.
- **The harness narrows the computers, not the other way round.** Softov's first thought was to pick the computer first and filter the harnesses by it, but VS Code picks the harness first and then draws the config chips. The `computer` answerer is already told the `provider` ([`code://packages/sdk/src/types/completions.ts#L27`](../../packages/sdk/src/types/completions.ts#L27)), so it can offer only the machines prepared for that harness, and a session never pairs the two wrongly.
- **A profile that asks for a value at create time** is an ahpapp feature, planned there through do-spec, since VS Code has no create-machine UI.
- **The shared-folder warning goes in the docs** for now.
- **The SDK surface is an optional `machine()` on `Agent`**: [decision](../decisions/an-agent-declares-its-machine-needs-with-a-method.md). The machine-making plugin still needs a way to read an agent's needs from the host.

## Disposable machines (Softov, 2026-09-26)

- **A disposable machine is a profile listed as a computer in the picker**, as `disposable: claude`, `disposable: <profile>`, beside the machines that exist. A profile opts in with `disposable: true`.
- **It is made when the session starts**, after the harness is chosen, so it takes that harness's `machine()` needs and the profile does not have to name agents. A long-lived machine is made before any session, which is why its profile names them. A copy-in is paid on every create, so a disposable machine prefers mounts.
- **It outlives its session by a delay the profile sets** (`disposableDelay: 300000`). While it lives it is an ordinary computer in the picker and other sessions can run in it; the delay starts when the last session using it is disposed, and a session that picks it cancels the timer.
- **`disposableAlone: true`** keeps it out of the picker, so only the session that made it runs there, and it goes when that session is disposed and the delay passes.
- A session that restarts before its first turn (`host/18`) keeps its machine.

## The history lives in the agent's folder, keyed by the path

Claude writes a session's transcript to `<config dir>/projects/<working directory, spelled with dashes>/<id>.jsonl` ([`code://packages/agent-claude/src/claude.ts#L372-L395`](../../packages/agent-claude/src/claude.ts#L372-L395)). With `~/.claude` mounted, a session in a machine writes into this host's folder, but under the directory it saw *inside the machine*. A workspace mounted at `/workspaces/app` instead of `/srv/app` puts its history under `-workspaces-app`: the host's list for `/srv/app` does not show it, and resuming it here or in another machine with another path does not find it. This is what matters most about the Claude folder.

The way to keep one history is to mount the session's folder at the same path inside the machine as on the host, so the spelled directory is the same everywhere. Softov chose same-path mounts for now; mapping between the two spellings when the host lists and resumes is for later. A machine that gets the folder by copy-in rather than a mount loses the history with the machine.

## Open

- **How the machine-making plugin reads an agent's `machine()`.** Proposed, not settled: the host hands the needs over rather than the plugin looking agents up. The host is the one thing that knows both the session's agent and its computer, so for a disposable machine it calls the computers port with the profile, `agent.machine()` and the session's folder, and the plugin never names an agent. A long-lived machine whose profile lists `agents` is made from a resource write, with no session, so for that case alone the plugin asks the host `machineNeeds(provider)` at create time, never at load, because the plugin that registers the agent may load after it. The machine records the agents it was prepared for as a label, which is what the `computer` answerer filters by and what the host checks before starting a session there.
