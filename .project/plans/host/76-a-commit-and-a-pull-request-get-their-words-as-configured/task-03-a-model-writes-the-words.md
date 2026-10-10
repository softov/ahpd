---
title: A model writes the words
status: done
depends: [task-02-forced-and-session-title-modes.md]
layer: sdk
refs:
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostPullRequestOperationHandler.ts#L636-L700 - the pull request prompt and how its answer is split
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentHostCommitOperationHandler.ts#L81-L150 - the commit message prompt over the uncommitted diff
---

## Objective

In model mode, the named model writes the words from VS Code's prompts, and a failure falls back to the session title.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - `wordsFor` asks the model in model mode.
- `CREATE: packages/sdk/src/changewords.ts` - the two prompts and the split of an answer into a title and a body.
- `UPDATE: packages/sdk/src/host/changesets.ts:176-356` - `watchTurn` waits for the turn under its limit, `askModel` opens the session it asks on, and `changeWordsOf` builds the ask or says what went without.
- `UPDATE: packages/sdk/src/types/host.ts` - `changeWordsTimeoutMs`, the limit on waiting for a turn asked for the words.
- `UPDATE: packages/sdk/src/host/context.ts` - `bareSessions`, the sessions that run with nothing to call.
- `UPDATE: packages/sdk/src/host/tooling.ts` - `boundTools` answers none for a session in that set.
- `UPDATE: packages/sdk/src/host/spawn.ts` - the MCP servers, the plugins and the tool server left out for one.
- `UPDATE: packages/sdk/src/host.ts` - the set, made with the rest of the context.
- `CREATE: packages/sdk/test/changewords.test.ts` - the prompts, the split, and the fallback.

## Steps

1. Port VS Code's two prompts with their inputs: the branch, the base, the changed files, the diff and the conversation.
2. Call the provider and model from the setting once, with no tools.
3. Split the answer at the first blank line, and cut a title at 72 characters.
4. Fall back to the session title on a failure or an empty answer, and say so in the operation's result.

## Validation

- Tests use a fake provider for a good answer, an empty one and a failure.
- The gates pass.

## Resume

- **Implemented** 2026-10-09 on `build/agents/016ab0b2`, uncommitted.
- `packages/sdk/src/changewords.ts` (101 lines) holds `TITLE_MOST` (72), `DIFF_MOST` (20,000), `commitPrompt`, `pullRequestPrompt`, `splitWords` and `cutDiff`. The two prompts carry a block per input - changed files, the diff, what was said, and for a pull request the branch and the base - and leave a block out whole when there is nothing to put in it. A diff over `DIFF_MOST` ends by saying it was cut.
- `packages/sdk/src/host/changesets.ts:219-258` is `askModel`. It opens a session named `${provider}:/${crypto.randomUUID()}` in the changeset's own directory with `ctx.openSession`, runs one turn on the named model, reads the answer off the turn and disposes of the session in a `finally`. `changes.ts` builds the prompt in `askOf` and splits the answer with `splitWords`; an empty or missing answer falls back to the session title and says `the model did not answer, so the session title was used`.
- No tools: `ctx.bareSessions` is added to before the session opens and dropped in the `finally`. `boundTools` (`tooling.ts`) answers none for a URI in the set, so a later `retool` cannot put one back, and `spawn.ts` leaves out the MCP servers, the plugins, the denied servers and the tool server. The set is made in `host.ts` with the rest of the context and is empty for a host that never opens one.
- `changeWordsOf` (`changesets.ts:287-317`) answers `why` instead of an ask when the mode cannot ask: no provider and model named, a provider this host does not serve, a session with no chat, an agent without `chats.sideChat`, a session with no turn. The source falls back with that sentence, so a mode with nothing behind it is a whole answer and not a refusal.
- `packages/sdk/test/changewords.test.ts` (22 tests) holds both halves: three for the split of an answer, four for the two prompts, and fifteen driving the modes through a real host over a real repository. The model tests check the message git actually kept, that one turn ran in a chat that is not the session's own, and that the throwaway session is gone from the root channel.
- **Departure 1.** The reader for the turn's end is armed before the turn starts, because a turn that answered before anything was listening would leave the ask waiting on an end that had already happened. `chat/turnComplete`, `chat/turnCancelled` and `chat/error` all resolve it, and a cancelled turn that said something first has still said it.
- **Departure 2.** The host's own turn is handed `{ origin: { kind: 'systemNotification' } }` as its `from`. The plan does not decide this; it is the shape a turn this host starts already takes for a session nobody typed in.
- **Departure 3.** The throwaway session is briefly visible to a client subscribed to the root channel - a `root/sessionAdded` and then a `root/sessionRemoved` - and `removeSession` asks the backend to delete its own copy of the session. Neither is hidden, and a client drawing the root list sees both.
- The limit on waiting for the words is `CHANGE_WORDS_MOST` (`changesets.ts:32`), two minutes, and `HostOptions.changeWordsTimeoutMs` sets it; zero there is no limit at all. `watchTurn` (`changesets.ts:176-217`) is the one watcher both modes wait on. It resolves `true` on `turnCompleted`, `turnCancelled` or `turnFailed`, and past the limit it logs, calls `Session.cancel(turnId)` and resolves `false`. The ask then answers `undefined`, so `wordsFor` falls back with the sentence it already used for a failure.
- The turn is stopped rather than merely abandoned, because a model still running would spend on words nobody will read. `askModel` disposes of its session either way; `askAgent` leaves its chat, as the plan decides.
- `packages/sdk/test/changewords.test.ts` covers the limit with a backend that takes the turn asked for the words and never finishes it, and the limit pushed to 50ms. The model case checks the fallback, the cancel, and that the throwaway session was still removed. The agent case checks the fallback, the cancel, and that the chat stays. A third checks that zero is no limit, and that an answer which arrives is still read.
- Gates: `node tools/schema.mjs`, `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass; the full suite is 266 files and 4,716 tests.
