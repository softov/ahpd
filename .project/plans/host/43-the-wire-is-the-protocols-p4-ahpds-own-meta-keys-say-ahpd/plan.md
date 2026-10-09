---
title: Every _meta key ahpd invents is named ahpd.<name>
domain: host
status: active
priority: high
created: 2026-10-03
revalidated: 2026-10-04
requires:
  - plans/host/43-the-wire-is-the-protocols/plan.md
  - plans/host/43-the-wire-is-the-protocols-p1-the-wire-test-checks-every-frame/plan.md
  - plans/host/44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md
refs:
  - "[code://packages/sdk/src/host/facts.ts#L160-L161](../../../../packages/sdk/src/host/facts.ts#L160-L161) - `_meta: { owner }` on a session with no directory"
  - "[code://packages/sdk/src/host/facts.ts#L174-L179](../../../../packages/sdk/src/host/facts.ts#L174-L179) - `owner` beside the git facts on the summary and the state"
  - "[code://packages/sdk/src/host/spawn.ts#L136-L141](../../../../packages/sdk/src/host/spawn.ts#L136-L141) - `sender` on a stored turn's `message._meta`"
  - "[code://packages/sdk/src/host/spawn.ts#L472-L476](../../../../packages/sdk/src/host/spawn.ts#L472-L476) - `sender` on a live `chat/turnStarted`"
  - "[code://packages/sdk/src/changes.ts#L634](../../../../packages/sdk/src/changes.ts#L634) - `_meta: { staged, unstaged }` on a changeset file"
  - "[code://packages/sdk/src/changes.ts#L108](../../../../packages/sdk/src/changes.ts#L108) - the host reads its own `staged` and `unstaged` back"
  - "[code://packages/sdk/src/changes.ts#L244](../../../../packages/sdk/src/changes.ts#L244) - and counts them"
  - "[code://packages/sdk/src/changes.ts#L1068-L1069](../../../../packages/sdk/src/changes.ts#L1068-L1069) - reads a client's `_meta['ahp.commit']`"
  - "[code://packages/agent-claude/src/session.ts#L326](../../../../packages/agent-claude/src/session.ts#L326) - `argumentHint` on a skill customization, ahpd's own by its comment"
  - "[code://packages/agent-claude/src/session.ts#L3125-L3127](../../../../packages/agent-claude/src/session.ts#L3125-L3127) - `model` on the session state"
  - "[code://packages/agent-claude/src/session.ts#L1291](../../../../packages/agent-claude/src/session.ts#L1291) - `cacheWriteTokens` on usage"
  - "[code://packages/agent-claude/src/session.ts#L2890](../../../../packages/agent-claude/src/session.ts#L2890) - `cost` on usage"
  - "[code://packages/agent-acp/src/mapping.ts#L406-L414](../../../../packages/agent-acp/src/mapping.ts#L406-L414) - `context` and `cost` on a live usage"
  - "[code://packages/agent-acp/src/session.ts#L1332-L1351](../../../../packages/agent-acp/src/session.ts#L1332-L1351) - `cacheWriteTokens`, `reasoningTokens`, `cost`, `context` at the turn's end, reading `context` back"
  - "[code://packages/agent-pi/src/mapping.ts#L159](../../../../packages/agent-pi/src/mapping.ts#L159) - `cacheWriteTokens`"
  - "[code://packages/agent-pi/src/mapping.ts#L185-L208](../../../../packages/agent-pi/src/mapping.ts#L185-L208) - sums its own previous `cacheWriteTokens` and `cost`"
  - "[code://packages/agent-cofold/src/mapping.ts#L104-L123](../../../../packages/agent-cofold/src/mapping.ts#L104-L123) - `cacheWriteTokens`, `reasoningTokens`, `cost`, live; not in the audit"
  - "[code://packages/agent-cofold/src/transcript.ts#L63-L74](../../../../packages/agent-cofold/src/transcript.ts#L63-L74) - the same two token keys, restored; not in the audit"
  - "[code://packages/agent-cofold/src/transcript.ts#L107-L113](../../../../packages/agent-cofold/src/transcript.ts#L107-L113) - `startedAt`, `endedAt`, `durationMs` on a restored tool call; not in the audit, and renamed by plugin/29 p5, or by task 05 if it builds first"
  - "[code://packages/sdk/src/meter.ts#L99-L147](../../../../packages/sdk/src/meter.ts#L99-L147) - the meter reads `cost` and `cacheWriteTokens` off every usage"
  - "[code://docs/AHP.md](../../../../docs/AHP.md) - lines 217, 246, 349, 633, 661, 675 name the old keys"
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - the reference's own keys, which stay"
  - "file:///github/ahpapp/src/blocks.ts - lines 457-458 read `cacheWriteTokens` and `reasoningTokens`"
  - "file:///github/ahpapp/src/components/RawView.tsx - lines 592 and 594 read the same two"
  - "file:///github/ahpapp/src/changes.ts - lines 122-123 read `staged` and `unstaged`"
  - "file:///github/ahpapp/src/changeset-ops.ts - line 207 sends `ahp.commit`"
  - "file:///github/ahpc/src/ahp/live.ts - line 3166 reads `_meta.model`"
---

## Goal

Every `_meta` key ahpd invents reaches a client as `_meta['ahpd.<name>']`, and a commit's message arrives as `_meta['ahpd.commit']`, so a reader can tell ahpd's extensions from the reference's.
The reference's own keys stay as they are, and ahpapp and ahpc move in the same wave, so nothing they show goes blank.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "_meta" packages/*/src` - the keys in the refs, and the reference's: `toolKind`, `subagent*`, `progressMessage`, `git`, `github`, `githubData`, `workingDirectoryKeys`, `command`, `description` and `argumentHint` on a completion item, `isSkill`, `kind: 'responseRoundEnded'`, `agentHost/sessionArtifacts`, `vscode.*`, `anthropic/alwaysLoad`.
- `rg -n "argumentHint" docs/AHP.md /github/ahpapp/src` - on a completion item it is the reference client's (`docs/AHP.md:556-569`) and stays; ahpapp `src/commands.ts:42` reads that one, not the skill's, so it does not change.
- `rg -n "meta.cost" /github/ahpc/src` - ahpc `src/ahp/live.ts:1171-1187` reads the reference host's `_meta.cost` as a plain number in credits; ahpd sends `{ amount, currency }` under the same name, which no client reads as cost today.
- `rg -n "sender|owner" /github/ahpapp/.project` - ahpapp `chat/02` task 02 (todo) will read `_meta.sender` and `_meta.owner`.
- `rg -ln "_meta" .project/decisions` - `a-tool-calls-times-are-stamped-by-its-plugin` chose `startedAt`, `endedAt`, `durationMs` unprefixed; it is superseded by [`a-tool-calls-times-are-stamped-as-ahpd-keys`](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md), which names them `ahpd.startedAt`, `ahpd.endedAt`, `ahpd.durationMs`.

### Gaps

- `cacheWriteTokens`, `reasoningTokens` and `cost` are also written by agent-cofold, and `startedAt`, `endedAt`, `durationMs` by its transcript; the audit missed both.
- The three timing keys are [plugin/29 p5](../../plugin/29-a-tool-call-says-when-it-ran-p5-cofold-stamps-its-live-calls/plan.md)'s to rename, through plugin/29 p1's helper; task 05 renames them only if plugin/29 p5 has not been built when it runs. No client reads them, so they need no read-both step.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Every ahpd-invented key becomes `_meta['ahpd.<name>']`, `ahp.commit` becomes `ahpd.commit`, and ahpapp and ahpc are updated in the same wave | Softov, 2026-10-03, asked "how are `_meta` keys that ahpd invents named?": "Rename all + clients" | 01-05 |
| The reference's keys are not renamed, `argumentHint` on a completion item among them | the request, 2026-10-03: "Keys that are VS Code's or the reference client's own ... are NOT renamed" | 03 |
| Host-to-client keys: the clients read both names, then ahpd renames, then the clients drop the old name | the request, 2026-10-03: "Order so nothing breaks" | 02, 03, 04 |
| Client-to-host `ahp.commit`: ahpd reads both first, then ahpapp sends `ahpd.commit`, then ahpd drops `ahp.commit` | (defaulted: the same rule, run in the direction the key travels) | 01, 05 |
| ahpd's `cost` becomes `ahpd.cost` and the reference's numeric `_meta.cost` is not sent | (defaulted: the reference's is a number in credits per ahpc `src/ahp/live.ts:1171`, and ahpd's is an amount and a currency; same name, different value) | 04 |
| ahpd's own readers (the meter, the changeset, pi's running sum, acp's `context`) move with the producers, in the same task | (defaulted: one repository, one change) | 02, 04 |

## Proposed architecture

- **Data flow** - every producer writes `ahpd.<name>`; ahpd's own readers read only the new name, since nothing stored keeps the old one (owner and sender live in the session store's own fields, usage is rebuilt from transcripts).
- **Layer responsibilities** - sdk: host, changes, meter · agent-claude, agent-acp, agent-pi, agent-cofold: their own keys · docs.
- **Source-of-truth files** - the producers in the refs; p1's `PENDING` list in [`code://packages/sdk/test/wire.test.ts`](../../../../packages/sdk/test/wire.test.ts).

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The commit message is read as ahpd.commit too](task-01-the-commit-message-is-read-as-ahpd-commit.md) | done | - |
| [02 - Owner, sender and staging are sent as ahpd keys](task-02-owner-sender-and-staging-are-ahpd-keys.md) | todo | ahpapp reading both names (ahpapp host/05, a66f582) |
| [03 - A Claude session's model and a skill's hint are ahpd keys](task-03-claudes-model-and-skill-hint-are-ahpd-keys.md) | todo | ahpc reading both names (ahpc ahp/07, a13ec65) |
| [04 - Usage extensions are ahpd keys in every backend](task-04-usage-extensions-are-ahpd-keys.md) | todo | ahpapp reading both names (ahpapp host/05, a66f582) |
| [05 - The old names are gone](task-05-the-old-names-are-gone.md) | todo | 01-04, and ahpapp sending `ahpd.commit` |

## Risks and tradeoffs

- Tasks 02 to 04 land only after the client releases that read both names; landing one early blanks the field in the client that reads it.
- A client that reads ahpd's `_meta` by prefix now finds every extension under `ahpd.`; one that read a bare name and is not ahpapp or ahpc stops seeing it.

## Resume state

- **Done so far:** task 01, merged 2026-10-08 (85b0dc4). The `commit` operation reads `_meta['ahpd.commit']` and falls back to `_meta['ahp.commit']`, with the comment naming task 05 as where the old key goes. Three cases in `packages/sdk/test/commit.test.ts` cover the new key, the old one, and the new one winning when both are sent, and `docs/AHP.md` says the same.
- **Next action:** tasks 02-04. ahpapp reads both names since host/05 (a66f582), and sends `ahpd.commit`; ahpc reads `ahpd.model` since ahp/07 (a13ec65). Task 05 waits until the ahpapp build people run sends `ahpd.commit`.
- **Answered:** the tool-call timing keys are prefixed too, as `ahpd.startedAt`, `ahpd.endedAt`, `ahpd.durationMs`: Softov, 2026-10-03, asked "Does \"Rename all + clients\" also cover the tool-call timing keys?": "We will prefix all.. then after I will see about that to remove the prefixes.. So its not a decision to rule.. Its to organize all that is not ahp protocol and to avoid breaking the protocol." The prefix marks what is not the protocol's, for now; it is not a standing rule. The decision `a-tool-calls-times-are-stamped-by-its-plugin` is superseded for the names only by [`a-tool-calls-times-are-stamped-as-ahpd-keys`](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md), and plugin/29 is amended to stamp the prefixed names, cofold's restored calls included (p5).
- **Requires:** [host/44 p1](../44-ahpd-speaks-ahp-1-0-0-p1-ahpd-speaks-1-0-0-and-0-9-0/plan.md), which moves ahpd to the 1.0.0 package.
- **Watch out for:** `argumentHint` is renamed on a skill customization only, never on a completion item; and `_meta.cost` must not come back as a number in dollars, which would read as credits in the reference.

## Final verification checklist

- [ ] p1's `PENDING` list is empty, and the census passes over the wire test and the four backends' usage tests.
- [ ] ahpapp and ahpc show cost, cache writes, staging and a session's model against a host built from this plan.
- [ ] `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.
- [ ] `plans/index.md` updated.
