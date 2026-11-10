---
title: Connectors and agents from the CLI
created: 2026-11-09
refs:
  - git://45983f869 - the commit of ahpd the facts were checked at
  - "[code://packages/server/src/commands/registry.ts#L61-L86](../../packages/server/src/commands/registry.ts#L61-L86) - `cliRegistry`, every command `ahpd` has, with no connector or agent command"
  - "[code://packages/sdk/src/connectors/channel.ts#L33-L58](../../packages/sdk/src/connectors/channel.ts#L33-L58) - the connector commands: put, remove, check, signin and signin-finish"
  - "[code://packages/sdk/src/connectors/channel.ts#L119-L128](../../packages/sdk/src/connectors/channel.ts#L119-L128) - the channel `x-ahpd-connectors` and its command names"
  - "[code://packages/sdk/src/agents/channel.ts#L83-L88](../../packages/sdk/src/agents/channel.ts#L83-L88) - the channel `x-ahpd-agents`, with put, remove and check"
  - "[code://packages/agent-claude/src/options.ts#L452-L465](../../packages/agent-claude/src/options.ts#L452-L465) - `logins`, a Claude agent's field that names `claude-login` connectors"
  - "[code://packages/sdk/src/connectors/fields.ts#L26](../../packages/sdk/src/connectors/fields.ts#L26) - `x-ahpd-connector`, the mark on a field that names a connector"
  - "[code://packages/server/src/commands/vault.ts#L152-L190](../../packages/server/src/commands/vault.ts#L152-L190) - `vault set`, a command with a CLI and an HTTP surface that reads a secret from standard input"
  - "[code://packages/server/src/commands/user.ts#L151-L154](../../packages/server/src/commands/user.ts#L151-L154) - `user add`, the shape of a record command"
  - "[code://.project/pending/rpc.mjs](../../.project/pending/rpc.mjs) - the only shell path to these channels today, one raw AHP request"
  - https://cli.github.com/manual/gh_auth_login - `gh auth login` signs in from a terminal, with a device code or a pasted token
---

# Connectors and agents from the CLI

Softov wants to add and change connectors and agents from a shell, not only in ahpw. A person makes a connector, makes an agent that uses it, and signs a connector in, such as a Claude login. Each step is an `ahpd` command, and a check by hand then tests them from the CLI.

## What others do

- `gh auth login` signs in at a terminal. It prints a one-time code and a URL, or reads a token from standard input, and waits for the approval.
- ahpd's own record commands follow one shape. `user add`, `vault set` and `automation list` each declare a CLI pattern and an HTTP path in one action. A secret comes on standard input, never on the command line.

## What ahpd has today

- `ahpd` has no connector command and no agent command ([`code://packages/server/src/commands/registry.ts`](../../packages/server/src/commands/registry.ts#L61-L86)). `ahpc` has none either.
- A connector is a record on the channel `x-ahpd-connectors`. Its commands are `put`, `remove`, `check`, `signin` and `signin-finish` ([`code://packages/sdk/src/connectors/channel.ts`](../../packages/sdk/src/connectors/channel.ts#L33-L58)).
- A sign-in answers a URL and a state, and `signin-finish` takes the pasted code. A device-code sign-in answers a code, and the host polls for the approval.
- An agent is a record on the channel `x-ahpd-agents`, with `put`, `remove` and `check` ([`code://packages/sdk/src/agents/channel.ts`](../../packages/sdk/src/agents/channel.ts#L83-L88)).
- An agent uses a connector through a field marked `x-ahpd-connector`. A Claude agent's `logins` names `claude-login` connectors ([`code://packages/agent-claude/src/options.ts`](../../packages/agent-claude/src/options.ts#L452-L465)).
- A put opens the connector and runs its check, so these commands need the running daemon. `vault` and `user` also work on the files with no daemon.
- From a shell today, only [`code://.project/pending/rpc.mjs`](../../.project/pending/rpc.mjs) reaches these channels, with raw JSON.

## Who writes

- PR #267 and PR #268 are open, on a Claude folder that is watched once. Neither touches `packages/server/src/commands/` or the two channels.
- No plan in `.project/plans/` that is not built names a connector or agent command.

## The change

- `ahpd connector` lists, adds, sets, checks and removes a connector. Each one sends the channel's command to the running daemon.
- `ahpd connector signin` starts a sign-in, prints the URL or the code, and finishes it with the pasted code or the approval.
- `ahpd agent` lists, adds, sets, checks and removes an agent. A field that names a connector takes the connector's id.
- A secret field comes on standard input, as `vault set` takes a value.
- Each command has a CLI pattern and an HTTP path, as the other record commands have.
- A check by hand in `.project/pending/` tests them: a connector, an agent that uses it, and a `claude-login` sign-in.

## Open points

- How the commands reach the daemon: over AHP, as ahpw does, or over the HTTP API, which needs `httpApi`.
- Whether `ahpc` gets the same commands, or only `ahpd`.
- How a command takes an adapter's config: one `--set key=value` for each field, or a JSON file.
