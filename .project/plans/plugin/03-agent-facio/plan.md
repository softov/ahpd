---
title: An agent backend over facio, so every model is one provider rather than one package
domain: plugin
status: active
priority: high
created: 2026-09-20
revalidated: 2026-09-20
requires: []
changes: []
creates: []
decisions:
  - decisions/agent-package-only-when-it-brings-a-runtime.md
refs:
  - code://packages/sdk/src/types/agent.ts#L66-L140 - `Start`, `BoundTool`, the tools and directories a session is created with, and `Agent` itself
  - code://packages/sdk/src/types/session.ts - `Session`, what `create` returns and what `begin`, `steer`, `cancel` and `ran` do
  - code://packages/sdk/src/types/host.ts#L279-L332 - `HostTool`, the host tools a model must be offered
  - code://packages/sdk/src/types/plugin.ts - `PluginHost`, `Plugin` and `PluginContext`, which the entry implements
  - code://packages/server/src/plugins.ts - `loadPlugins`, which resolves and imports this package by spec
  - code://.project/decisions/agent-package-only-when-it-brings-a-runtime.md - why this is one package and not one per model
  - code://.project/ideas/agents-as-extensions.md - the first-party order this plan is the first step of
  - file:///github/facio/packages/agents/src/index.ts - `createAgent`, `run`, `resume`, `createTool`, the store and the policy
  - file:///github/facio/packages/agents/src/types/event.ts - the `RunEvent` union this bridge maps onto `chat/*`
  - file:///github/facio/packages/agents/src/types/run.ts - `RunArgs`, `ResumeArgs` and `RunHandle`, the stream and the cancel
  - file:///github/facio/packages/agents/src/types/agent.ts - `AgentOptions` and `Policy`, what a facio agent is built from
  - file:///github/facio/packages/agents/src/types/store.ts - the `Store` that `list()` and `transcript()` read, which already names the AHP workspace
  - file:///github/facio/packages/agents/src/types/message.ts - the message the transcript is built from
  - file:///github/facio/packages/model-openai-compat/src/index.ts - `openaiCompat`, the model adapter the session config selects
  - file:///github/facio/packages/store-file/src/index.ts - `createFileStore`, the store a daemon wants
  - code://test/example.test.ts#L1-L30 - the fake peer and the turn a bridge test follows
---

## Goal

`@ahpd/agent-facio` is an installed package and a plugin that runs facio's agent runtime as an AHP backend, so every model facio can reach is a model inside one provider rather than a package of its own.
A client creates a session on provider `facio`, the session config chooses the model and the endpoint, and the conversation, tools, approvals, pause and resume, catalogue and transcript all behave the way a backend is expected to.
A model that facio cannot reach is a facio adapter and a configuration line, and never an ahpd release.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg "export function run|export function resume" packages/agents/src` - `run(RunArgs): RunHandle` and `resume(ResumeArgs): RunHandle`, where `RunHandle` carries `events: AsyncIterable<RunEvent>`, `submit`, `cancel` and `outcome`, which is the whole of what an AHP turn needs.
- `rg "workspace" packages/agents/src/types/store.ts` - `SessionRecord.workspace` is documented as "the AHP transport passes SessionOptions.cwd", so the store was written with this bridge in mind and the directory maps without a translation table.
- `rg "@facio/" packages/*/package.json package.json` in ahpd - nothing, so this plan adds the first dependency on facio.
- `npm view @facio/agents version` - `404`, so the harness is not published and the bridge is developed against a linked checkout until it is.
- `rg "chat/turnStarted|chat/toolCallStart|session/inputNeededSet" packages/sdk/src/host.ts` - the action names and the shapes a backend emits, which the bridge reuses rather than invents.
- `rg "acp" packages/acp -g package.json` in `/github/deepseek-harness` - `@deepseek-ai/dsh-acp` is an Agent Client Protocol server, so deepseek-harness is the ACP plan's work and not this one, which is the decision this plan applies.
- `Not found: any dependency on facio in ahpd, and any bridge to a harness that is not Claude - searched "@facio" and "RunEvent" in packages/ and test/.`

### Runtime path

```
ahpd --plugin @ahpd/agent-facio
  -> loadPlugins resolves it, checks its manifest, imports it, apply(host) registers one Agent with provider `facio`
  -> createSession -> the bridge builds a facio Agent: createAgent({ instructions, model, tools, store, policy })
  -> Session.begin(turn) -> run({ agent, session, input }) -> RunHandle.events
       run.started        -> chat/turnStarted
       model.delta        -> chat/responsePart + chat/delta, reasoning -> chat/reasoning
       tool.*             -> chat/toolCallStart / chat/toolCallUpdate / chat/toolCallComplete
       approval.requested -> chat/inputNeededSet + confirm; the answer -> handle.submit
       input.requested    -> chat/inputNeededSet + the questions; the answers -> handle.submit
       run.finished       -> chat/turnComplete, cancelled -> chat/turnCancelled
  -> Agent.list() and Agent.transcript(id) read the facio Store
  -> a paused run comes back through resume({ sessionId, runId })
```

### Gaps

- ahpd cannot install facio yet: the package is unpublished, so the workspace needs a link and the dependency a range later.
- Nothing maps `RunEvent` onto `chat/*`, and nothing builds a facio `Agent` from AHP session config.
- The host tools a session is given (`Start.tools`) are never offered to a model, so a facio session would run without `sessionTools` and `artifactTools`.
- `approval.requested` and `input.requested` have no AHP counterpart written, and AHP's `confirm` and its answers have no route back into a facio run.
- `Not found: a mapping from a facio Message to an AHP WireTurn - searched "Message" in `types/message.ts` and the transcript path in `host.ts`; the transcript is the one shape that has to be built rather than renamed.`

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [A new `@ahpd/agent-*` package exists only when the target brings its own agent runtime](../../../decisions/agent-package-only-when-it-brings-a-runtime.md) | Softov, 2026-09-20: "we only make a new @ahpd/agent-* if its a new way to talk to a agent. not a v1/completion thing. since it will need a harness creation... if it uses a api and need a harness.. then it will be facio. if not,. like claude... then its a new package plugin" |

| What | Source | Task |
| --- | --- | --- |
| One provider, `facio`, with the model and endpoint as session config | decision 1 | 01 |
| The model adapter is `@facio/model-openai-compat`, configured by the session config | decision 1 | 01 |
| The daemon's store is `@facio/store-file`, under the configuration directory | decision 1 | 01, 04 |
| The AHP host tools are handed to facio as tools, so the model can call them | `Start.tools`, `HostTool` | 02 |
| `RunEvent` is mapped, not reshaped; facio changes only where AHP needs a fact it does not carry | Softov, 2026-09-20: "If necessary and needed, we could change the code to map 1:1 since its ours code" | 02, 03 |
| Approval and questions become `inputNeededSet` and are answered back into the run | `session/inputNeededSet`, `RunEvent` | 03 |
| `list()` and `transcript()` read the facio `Store`; the workspace is the directory AHP already passes | `SessionRecord.workspace`, `Store.sessions` | 04 |

## Proposed architecture

- **Data flow** - a session's config becomes a facio `Agent`, a turn becomes `run()`'s event stream, and each event becomes the AHP action a client already knows; the client's answer to a pause goes back through `RunHandle.submit`.
- **Event flow** - none of AHP's own; this package subscribes to nothing. The bridge is the consumer of facio's stream and the producer of `chat/*` actions, which is what a backend is.
- **State flow** - the conversation lives in a facio `Store`, one file store beside the daemon configuration with the workspace as the partition; the AHP session id is the facio `sessionId`, so a resume after a restart is `resume()` and not a replay.
- **Layer responsibilities** - `packages/agent-facio`: the `Agent`, the `Session`, the `RunEvent` mapping, the config schema, the store wiring and the plugin entry. `/github/facio`: unchanged except where the bridge finds a fact AHP needs and facio does not carry, which is a change to record before it is made.
- **Source-of-truth files** - `code://packages/agent-facio/src/index.ts`, `code://packages/agent-facio/src/agent.ts`, `code://packages/agent-facio/src/session.ts`, `code://packages/agent-facio/src/mapping.ts`, `code://packages/agent-facio/src/plugin.ts`.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The package, the provider and its config](task-01-the-package-and-the-provider.md) | done | - |
| [02 - A turn becomes the chat actions](task-02-a-turn-becomes-the-chat-actions.md) | done | 01 |
| [03 - Approval and questions pause the run and come back](task-03-approval-and-questions.md) | done | 02 |
| [04 - The catalogue, the transcript and resume](task-04-catalogue-transcript-and-resume.md) | done | 01 |
| [05 - The plugin entry, and a daemon that serves it](task-05-the-plugin-entry-and-end-to-end.md) | done | 02, 03, 04 |

## Risks and tradeoffs

- `@facio/agents` is unpublished and in developer preview - the bridge is developed against a linked checkout, its dependency becomes a range when facio publishes, and the ahpd package is marked experimental until then.
- A harness under active change makes the bridge a moving target - the mapping lives in one file so a `RunEvent` change is one edit, and any facio change this bridge needs is recorded as a decision rather than made quietly.
- Host tools must reach the model or a facio session is a session without `sessionTools` - task 02 wraps each `BoundTool` with `createTool` and maps the result back, and a test asserts the model was offered them.
- An API key in session config would be written down by a client - the schema carries the key as a session setting the client sends, the store keeps settings rather than the resolved environment, and the docs say to put the key in the daemon's environment where it is not stored per session.
- The daemon may already have Claude registered - the two providers differ, so nothing collides, and the collision refusal stays the check that would catch a second `facio`.
- The transcript is the one shape that is not a rename - a test pins one turn with a tool call and a reasoning delta round-tripping through `transcript()`, so a mapping that loses a part fails rather than rendering empty.

## Resume state

- **Done so far:** tasks 01 to 04, done 2026-09-20.
- **Next action:** [task-05-the-plugin-entry-and-end-to-end.md](task-05-the-plugin-entry-and-end-to-end.md), which also pins the resume shape task 04 left open.
- **Open questions:**
  1. Settled: facio is linked, not published - the three packages are `link:` deps of `packages/agent-facio` and of the root devDependencies, and their `dist/` is built in the facio checkout before the bridge typechecks.
  2. Settled: one provider `facio` by default with a provider override in the options, so two model-backed backends can be put side by side.
  3. Settled: the store is `options.store`, a memory store for a test, and otherwise a directory under `XDG_DATA_HOME`, because `PluginContext` carries the served directories and not the configuration directory.
- **Watch out for:** pnpm's store is outside this checkout, so `pnpm install` needs wider file access than the default sandbox allows; and `@facio/agents` resolves from `node_modules/@facio` at the root, so a future `pnpm install` without network or with the links removed leaves the package unable to typecheck.

## Final verification checklist

- [ ] `pnpm test` green, with a mapped turn, a pause and answer, a resume and a transcript in it.
- [ ] `pnpm typecheck` and `pnpm boundary` green, with `packages/agent-facio` declaring what it imports.
- [ ] By hand: the daemon started with `--plugin @ahpd/agent-facio` serves provider `facio`, and a turn answers from a model through a configured endpoint.
- [ ] By hand: a client that needs a confirmation is asked, answers, and the run continues.
- [ ] By hand: a daemon restarted mid-conversation lists the session and resumes it.
- [ ] `docs/PLUGINS.md` names the package and its session config.
- [ ] `plans/index.md` and `plans/plugin/00-plugin.md` updated.
