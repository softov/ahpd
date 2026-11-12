---
title: A tunnel port with another protocol is replaced
domain: plugin
status: planned
priority: high
created: 2026-11-12
revalidated: 2026-11-12
refs:
  - "[code://packages/tunnel-devtunnel/src/service.ts#L409-L418](../../../../packages/tunnel-devtunnel/src/service.ts#L409-L418) - `add` and `access` write the port and pass a refusal on"
  - "[code://packages/tunnel-devtunnel/src/service.ts#L452-L458](../../../../packages/tunnel-devtunnel/src/service.ts#L452-L458) - `portOf` writes the protocol `auto`"
  - git://539740e14 - the protocol moved from `http` to `auto`
  - git://6616d1537 - the last commit that holds the problem file this plan replaces, `problems/a-kept-tunnel-port-with-another-protocol-fails-the-start.md`
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/dev_tunnels.rs#L1119-L1141 - VS Code's CLI removes the port and adds it again on this refusal
  - https://github.com/microsoft/vscode/blob/1564f100807a/cli/src/tunnels/dev_tunnels.rs#L1340-L1348 - VS Code's CLI matches the refusal by its text
---

## Goal

A tunnel kept from an ahpd older than `539740e14` starts after an upgrade.
Its ports were written as `http`, ahpd writes them as `auto`, and the Dev Tunnels service refuses that change.
ahpd then removes the port and writes it again, as VS Code's CLI does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "createOrUpdateTunnelPort|updateTunnelPort" packages/tunnel-devtunnel/src` - two writes, in `add` and in `access`.
- `devtunnel port list` on Softov's tunnel on 2026-11-11 - port 31546 was `http`, and the start failed with "The tunnel port protocol cannot be changed".

### Runtime path

```
kind start -> service.host().add(port) -> createOrUpdateTunnelPort -> service refuses -> tunnel status error
```

### Gaps

- `add` and `access` do not recover from the refusal.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Remove the port and write it again when the service refuses the protocol, as VS Code's CLI | Softov, 2026-11-11: "lets plan it" | 01 |
| Match the refusal by the text "The tunnel port protocol cannot be changed", as VS Code's CLI | (defaulted: the SDK gives no error code for it) | 01 |

## Proposed architecture

- **Data flow** - `add` and `access` catch the refusal, call `deleteTunnelPort`, and write the port again.
- **Layer responsibilities** - tunnel-devtunnel: the service wrapper alone.
- **Source-of-truth files** - [`code://packages/tunnel-devtunnel/src/service.ts`](../../../../packages/tunnel-devtunnel/src/service.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A refused protocol is written again](task-01-a-refused-protocol-is-written-again.md) | implemented | - |

## Risks and tradeoffs

- A port removed and added again drops the connections it carries. The refusal comes only at a start or an access change, when nothing is connected yet.
- The match is on the service's text. A changed text makes the start fail as it does today, and the test names the text.

## Resume state

- **Done so far:** task 01 is implemented.
  `sdkService.add` and `sdkService.access` remove a port and write it again when the service refuses its protocol.
  The tests stand the refusal in with a `refuse` text on the fake `Host`.
  Nothing is committed; the diff is in the worktree.
- **Next action:** review task 01 and run `packages/tunnel-devtunnel`'s suite.
- **Watch out for:** plugin/20261112-0145-a-tunnel-visitor-is-the-named-person builds on this branch and changes the same file.
  The recovery is in `sdkService` over the `Host`, not in `sdkCloud`, so that the stand-in client can exercise it.
  A second `updateTunnelPort` would fail after the delete, because the SDK sends `If-Match: *`; the retry writes with `Host.add`.
  `replace` writes its new port with a bare `Host.add` and does not recover from the same refusal.

## Final verification checklist

- [ ] `npx vitest run packages/tunnel-devtunnel` passes, with the new cases.
- [ ] `pnpm typecheck` passes.
