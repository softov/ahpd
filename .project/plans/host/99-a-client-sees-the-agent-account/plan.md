---
title: A client sees the agent account
domain: host
status: built
priority: low
created: 2026-10-16
revalidated: 2026-10-16
changes: []
creates: []
decisions:
  - decisions/an-agent-account-is-shown-to-account-readers.md
refs:
  - "[code://packages/sdk/src/types/probe.ts#L4-L44](../../../../packages/sdk/src/types/probe.ts#L4-L44) - `Offered`, what a probe answers"
  - "[code://packages/sdk/src/types/agent.ts#L492-L504](../../../../packages/sdk/src/types/agent.ts#L492-L504) - `protectedResources`, the neighbour the idea names"
  - "[code://packages/agent-claude/src/probe.ts#L49-L107](../../../../packages/agent-claude/src/probe.ts#L49-L107) - the Claude probe, which reads `initializationResult()` and drops its `account`"
  - "[code://packages/agent-claude/src/claude.ts#L474-L479](../../../../packages/agent-claude/src/claude.ts#L474-L479) - the probe runs in the served folder, not a folder from a client"
  - "[code://packages/sdk/src/host.ts#L1023-L1043](../../../../packages/sdk/src/host.ts#L1023-L1043) - the boot probe loop, which ends in `root/agentsChanged`"
  - "[code://packages/sdk/src/host/root.ts#L137-L148](../../../../packages/sdk/src/host/root.ts#L137-L148) - `AgentInfo`, built from what the probe learned"
  - "[code://packages/sdk/src/host/root.ts#L233-L240](../../../../packages/sdk/src/host/root.ts#L233-L240) - `ROOT_CONFIG_SCHEMA`"
  - "[code://packages/sdk/src/host/root.ts#L335-L344](../../../../packages/sdk/src/host/root.ts#L335-L344) - `daemonKey` and `declaresConfigKey`"
  - "[code://packages/sdk/src/host.ts#L570-L593](../../../../packages/sdk/src/host.ts#L570-L593) - `root/configChanged` is filtered per connection"
  - "[code://packages/sdk/src/host/gate.ts#L355-L356](../../../../packages/sdk/src/host/gate.ts#L355-L356) - `seesConfig`"
  - "[code://packages/sdk/src/access/users.ts#L30-L61](../../../../packages/sdk/src/access/users.ts#L30-L61) - the roles and the subjects"
  - "[code://packages/sdk/src/usage/usage.ts#L924-L975](../../../../packages/sdk/src/usage/usage.ts#L924-L975) - `usageMethods`, a grant of its own"
  - "[code://packages/agent-acp/src/agent.ts#L129](../../../../packages/agent-acp/src/agent.ts#L129) - the ACP probe answers empty and spawns nothing"
  - "[code://packages/agent-acp/src/connection.ts#L209-L252](../../../../packages/agent-acp/src/connection.ts#L209-L252) - the ACP notification handlers"
  - "[code://docs/sdk/AUTHENTICATION.md#L230-L235](../../../../docs/sdk/AUTHENTICATION.md#L230-L235) - what is readable before a sign-in"
  - "npm://@anthropic-ai/claude-agent-sdk@^0.3.301 - `AccountInfo` and `accountInfo()`"
  - "npm://@agentclientprotocol/codex-acp@1.13.1 - `_auth/status_update`, advertised as `authStatus` in `agentCapabilities._meta`"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/vscode/codexAccount.ts#L9-L74 - `vscode.codexAccount` and `ICodexAccountInfo`"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/codex/codexAccountState.ts#L11-L32 - an API key account maps to `unavailable`"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/codex/codexAgent.ts#L1453-L1455 - `_publishAccountInfo` writes a root config value"
  - "file:///github/externals/vscode/src/vs/workbench/services/agentHost/browser/codexAccountService.ts#L161-L167 - the window reads it from the root state"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/common/meta/vscode/agentAuthenticationAccount.ts#L8-L41 - `vscode.authentication.account`, a client's chosen account and not this one"
---

## Goal

A client sees which account each agent bills to: the email and the plan the provider's CLI is signed in as.
An agent on an API key or on a preset's environment says `unavailable`.
The shape follows VS Code's `vscode.codexAccount`, so VS Code's window can read the Codex account as it does from its own host.

## Reconnaissance

### Searches performed

- `rg -n "initializationResult|accountInfo" packages/agent-claude/src` - the probe and `servers.ts:193` call it, and nothing reads `account`.
- `rg -n "AccountInfo" packages/agent-claude/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` - `email`, `organization`, `subscriptionType`, `tokenSource`, `apiKeySource` and `apiProvider`.
- `rg -n "_auth/status_update|authStatus" codex-acp/dist/index.js` - the notification kinds: `account`, `api_key`, `gateway` and `none`.
- `rg -n "CODEX_ACCOUNT_META_KEY" /github/externals/vscode/src/vs` - VS Code publishes it as a root config value and reads it in the window.

### Runtime path

- The host boots -> each agent's `probe()` runs once -> `root/agentsChanged` lists what each offers.
- The Claude probe starts a silent `query()` in the served folder -> `initializationResult()` answers with `account`.
- `codex-acp` starts -> it sends `_auth/status_update` -> the ACP connection has no handler for it.
- VS Code's Codex agent reads `account/read` -> it writes `vscode.codexAccount` to the root config -> the window shows it in its account menu.

### Gaps

- The Claude account is in the probe's answer and is dropped, so no `claude auth status` call is needed.
- The probe runs in the served folder, so no folder from a client reaches it.
- The ACP backend spawns nothing at boot, so the Codex account is known only once a session starts, and the plan keeps it so.
- Root state is readable before a sign-in, so an email in it reaches every connection unless it is filtered.
- VS Code has a key for Codex only, and none for Claude.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The Claude account comes from the boot probe's `initializationResult()` | (defaulted: the probe already reads it, in the served folder) | 01 |
| An API key, a gateway or no sign-in gives `unavailable` or `signedOut`, as `codexAccountState.ts` maps it | (defaulted: VS Code's states) | 01, 03 |
| The account is a root config value, shaped like VS Code's `vscode.codexAccount` | Softov, 2026-10-16, chose "a root config value shaped like VS Code's `vscode.codexAccount`" for "Where is the account published?" | 02, 04 |
| A new `account` subject with `account:read` grants the read | Softov, 2026-10-16, chose "a new `account` subject with `account:read`" for "Who may read it?" | 02, 04 |
| The Claude account uses VS Code's `ICodexAccountInfo` fields | Softov, 2026-10-16, chose "VS Code's `ICodexAccountInfo` fields under an ahpd key" for "Claude's fields?" | 01, 02 |
| The Codex account comes from a live session only, with no boot spawn | Softov, 2026-10-16, chose "from a live session only" for "When is the Codex account read?" | 03 |
| The email is shown to the holders of the grant, as decision [an agent account is shown to account readers](../../../decisions/an-agent-account-is-shown-to-account-readers.md) says | Softov, 2026-10-16, chose "yes, to grant holders" for "Is the email shown at all?" | 02, 04 |

## Proposed architecture

- **Data flow:** a probe or an ACP notification -> the host keeps one account per agent -> the connections that may read it.
- **Layer responsibilities:** agent-claude: the probe returns it. agent-acp: the connection takes `_auth/status_update`. sdk: the host publishes and filters it. docs: `HOST.md`, `AGENT.md` and `AUTHENTICATION.md`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The Claude probe reports its account](task-01-the-claude-probe-reports-its-account.md) | done | - |
| [02 - The host publishes each agent account](task-02-the-host-publishes-each-agent-account.md) | done | 01 |
| [03 - The ACP backend hears the Codex account](task-03-the-acp-backend-hears-the-codex-account.md) | done | 02 |
| [04 - The docs say who sees the account](task-04-the-docs-say-who-sees-the-account.md) | done | 02, 03 |

## Risks and tradeoffs

- The email of the operator goes to every connection that may read it, and a remote guest may be one of them.
- A filter per connection on a root value adds a third overlay to the root state, beside `config` and `required`.
- The Claude account is read once at boot, so a `claude login` after boot is not seen until a restart.

## Resume state

- **Done so far:** drafted 2026-10-16 from the idea `a-client-sees-which-account-an-agent-bills-to.md`. Planned 2026-10-16 with Softov's answers. Task 01 built 2026-10-16: `Offered.account` as `Account`, and the Claude probe maps `initializationResult().account` onto it. Task 02 built 2026-10-16: the host keeps one account per backend in `Learned.account`, publishes it on the root config under `accountKey`, keeps it off the schema so a client cannot push one, and filters it per connection with `seesAccount` - in the snapshot and in every `root/configChanged`. The `account` subject's one operation is `status`, not `read`, which is the group. Task 03 built 2026-10-16: the ACP connection reads `authStatus` off the handshake and takes `_auth/status_update`, mapping the five kinds codex-acp 1.13.1 sends onto task 01's states and handing the account to `start.onAccount`. `external`, which the task did not name, is mapped like VS Code maps a non-ChatGPT account. Task 04 built 2026-10-16: `AGENT.md`, `HOST.md` and `AUTHENTICATION.md` say what the account is, where it is published and which grant reads it, and the `account:read` row went to `HOST.md`'s Grants table because `REMOTE.md`'s table is one row per `ahpd` verb. Reviewed and merged in `e01ee998`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:**
  - Decision `a-role-refuses-at-the-dispatch-boundary.md` says the root state is never hidden, so the filter is an overlay as in `host.ts:570-593`.
  - The key for the Claude account is ahpd's own, because VS Code has a key for Codex only. Task 02 names it after `vscode.codexAccount`.
  - Decision `root-config-declares-what-vscode-pushes-and-refuses-the-rest.md` governs a new root config key.
  - The SDK `AccountInfo` type is from 0.3.278 in `node_modules`, and the range is `^0.3.301`. Read the installed type first.

## Final verification checklist

- [x] A test: the Claude probe's account reaches a connection with the grant.
- [x] A test: a connection without the grant never gets the email.
- [x] A test: an `_auth/status_update` from ACP updates the account.
- [x] The gates pass: build, typecheck, boundary, schema and vitest.
- [ ] By hand: VS Code's account menu shows the Codex account from this host.
- [x] `plans/index.md` updated.
