import { rmSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { optionDefaults, storedSandbox } from './options.js';
import { idOf, titleFrom, uriOf } from '@ahpd/sdk';
import type { Bag, BoundTool, Session } from '@ahpd/sdk';
import { bag, list, str } from './session/common.js';
import { createAsking } from './session/asking.js';
import { createClientTools } from './session/clienttools.js';
import { createConfig, listsOf } from './session/config.js';
import type { ClaudeSessionOptions, PendingSdkMessage, SessionContext } from './session/context.js';
import { createLogins } from './session/logins.js';
import { createParts } from './session/parts.js';
import { createQuery } from './session/query.js';
import { createClaudeTerminalOutputs } from './session/savedoutput.js';
import { createServers } from './session/servers.js';
import { createStream } from './session/stream.js';
import { createTurns } from './session/turns.js';
import { createWorkers } from './session/workers.js';

export { keptLabel } from './session/asking.js';
export { INTERNAL_AGENT, customizationsOf, resolveClaudeAgentName } from './session/customizations.js';
export { EFFORT_DESCRIPTIONS, EFFORT_LABELS, EFFORTS, SDK_DEFAULT_MODEL_VALUE } from './session/config.js';
export type { ClaudeSessionOptions } from './session/context.js';
export type { Published } from './session/customizations.js';

/**
 * One agent session, reduced into the state its channels hold.
 *
 * The agent SDK reports what happened as its own message stream; a host has to
 * report the same events as AHP state actions. This module is that
 * translation, and holds the resulting state for a subscription snapshot.
 *
 * Rules the protocol requires of anything emitting chat actions:
 *
 * - A response part must exist before text streams into it: emit
 *   `chat/responsePart` to create it, then `chat/delta` to append. A delta
 *   naming a part that was never opened appends to nothing.
 * - The running turn is `activeTurn` and is not in `turns`. It moves into
 *   `turns` when it completes.
 * - A turn carries both sides: `message.text` is what the person said,
 *   `responseParts` is what the agent answered.
 * - The client starts turns. `chat/turnStarted` arrives from the client; the
 *   host reduces it and runs the agent.
 */

export function createSession(options: ClaudeSessionOptions): Session {
  const { uri, chatUri, cwd, emit } = options;

  /*
   * The declared values, from the preset or from the record live.
   *
   * A record is edited while this session runs, so its values are read at each
   * turn and the CLI is restarted when they changed; a preset cannot change
   * under a running daemon and is read once.
   */
  const live = (): Bag => options.presetOf?.() ?? options.preset ?? {};
  const valuesOf = (preset: Bag): Bag => ({
    ...optionDefaults(),
    ...preset,
    ...(preset['sandbox'] === 'off' ? {} : storedSandbox(options.settings)),
  });

  const ctx = {
    options,
    emit,
    config: { permissionMode: 'default', ...options.settings } as Record<string, unknown>,
    allowed: listsOf(options.settings?.permissions) ?? { allow: [], deny: [] },
    chosen: undefined as string | undefined,
    appliedEffort: undefined as string | undefined,
    offering: [] as BoundTool[],
    query: undefined as ReturnType<typeof query> | undefined,
    active: undefined as Bag | undefined,
    title: titleFrom(str(bag(bag((options.seed ?? [])[0]).message).text) ?? '', 'New session'),
    modified: new Date().toISOString(),
    startedAt: 0,
    resumedFrom: undefined,
    failed: undefined as string | undefined,
    rebind: undefined as unknown,
    interrupted: false,
    stopAnswers: undefined as Set<string> | undefined,
    ran: undefined as string | undefined,
    streaming: undefined as string | undefined,
    pendingPromptDeferred: undefined as (() => void) | undefined,
    disposed: false,
    additionalDirectories: [...(options.additional ?? [])] as string[],
    steering: undefined as Bag | undefined,
    yielded: new Map<string, PendingSdkMessage>(),
    parentSdkUuid: undefined as string | undefined,
    hostInstructions: undefined as { turn: Bag; said: string[] } | undefined,
    appliedAgent: undefined as string | undefined,
    sdkSessionId: options.resume as string | undefined,
    init: undefined as Bag | undefined,
    gone: undefined as string | undefined,
    customizations: [] as Bag[],
    // The agent's own, which the host seeds a session with, until a CLI answers.
    models: [...(options.seedModels ?? [])] as { id: string; name: string }[],
    /*
     * A preset that says the sandbox is off, which a stored `on` does not
     * override.
     *
     * `sandboxEnabled` is the control a session had before the schema stopped
     * declaring it, and an `on` of it is spread over the preset so an upgrade
     * never runs a session less sandboxed than it was. A preset saying `off`
     * is somebody asking for no sandbox, and it is the value that has to win:
     * otherwise a variant built to run unsandboxed runs sandboxed on every
     * session whose sandbox was once turned on. `valuesOf` is where that rule
     * lives, because a record's values are built there again on every turn.
     */
    values: valuesOf(live()),
    valuesOf,
    appliedValues: '',
    draft: undefined as Bag | undefined,
    preparingTurn: undefined as string | undefined,
    // The tools the session was built with, which the first CLI is given.
    toolDiff: (options.tools ?? []) as BoundTool[] | undefined,
    turns: [...(options.seed ?? [])] as Bag[],
    self: undefined as unknown as Session,
  } as SessionContext;
  const config = createConfig(ctx);
  const asking = createAsking(ctx);
  const clientTools = createClientTools(ctx);
  const workers = createWorkers(ctx);
  const servers = createServers(ctx);
  const lifecycle = createTurns(ctx);
  Object.assign(ctx, config);
  Object.assign(ctx, clientTools);
  Object.assign(ctx, createParts(ctx));
  Object.assign(ctx, workers);
  Object.assign(ctx, createStream(ctx));
  Object.assign(ctx, createClaudeTerminalOutputs(ctx));
  Object.assign(ctx, asking);
  Object.assign(ctx, createLogins(ctx));
  Object.assign(ctx, createQuery(ctx));
  Object.assign(ctx, servers);
  Object.assign(ctx, lifecycle);

  /*
   * The model this session was stored on, taken before the CLI is there.
   *
   * A restored session carries the model it last ran on in its settings, and
   * nothing else says which: this session has not asked the CLI anything, and
   * its first query has not been built. So the stored id is taken here and
   * reported from the first moment, the way a session that never stopped
   * reports what it is on.
   *
   * Only when this variant offers it. `default` is the CLI's own choice rather
   * than a model in any list, and a stored id a variant's endpoint does not
   * serve must not reach a CLI that would refuse it - which leaves the session
   * on what it always ran on, as an unstored one does.
   */
  const stored = options.settings?.model;
  if (typeof stored === 'string' && stored !== 'default'
    && (options.seedModels ?? []).some((model) => model.id === stored)) ctx.chosen = stored;
  if (ctx.config.shellInitScripts !== undefined) ctx.setShellInit(ctx.config.shellInitScripts);

  /*
   * The host's own tools and the clients', as the two in-process MCP servers
   * the CLI does not have to find.
   *
   * `createSdkMcpServer` runs in this process rather than spawning anything,
   * so a host tool is a function call and not a subprocess. Declared at
   * construction so `setMcpServers` keeps them: that call replaces the whole
   * set, and a set rebuilt without them would take the tools away.
   */
  ctx.buildClientMcpServers();

  /*
   * The session before its first send, which starts its CLI: VS Code's
   * provisional session, made with no SDK contact. Until a CLI answers, its
   * lists are the agent's own with the disk scan, and the login a CLI would
   * sign in with is the first the record names that is ready, which each send
   * chooses again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1543-L1556
   */
  ctx.customizations = ctx.provisionalCustomizations();
  ctx.login = ctx.loginFor(ctx.values);

  /*
   * Everything this session is waiting on a person or a client for.
   *
   * Two kinds in one list: a confirmation `canUseTool` is holding, and a call a
   * client is running. A client watching only the session reads this to know
   * what to draw, and for a `toolClientExecution` entry the answer is that
   * client's own - which is what lets a client that never sees the chat still
   * run the call.
   */
  const needed = (): Bag[] => [...ctx.pending.values()].map((one) => one.request).concat(ctx.calls.entries());

  const self: Session = {
    ...config.methods,
    ...clientTools.methods,
    ...workers.methods,
    ...asking.methods,
    ...servers.methods,
    ...lifecycle.methods,
    uri,
    chatUri,
    status: () => ctx.status(),

    models: () => ctx.models,
    agentId: () => ctx.sdkSessionId,
    busy: () => ctx.hasActiveWork() || ctx.stopped.sessionCrons.length > 0,
    forkPoint: (turnId) => ctx.ends.get(turnId),
    endPoint: (turnId) => ctx.ends.get(turnId),

    customizations: () => ctx.customizations,
    allTurns: () => ctx.turns,
    /*
     * Nothing: a chat's activity is a wait before its turn can run, as VS Code's
     * host says one, and a turn here runs once the host hands it over, its
     * thinking, its tools and its questions shown in its own parts.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724
     */
    activity: () => undefined,
    title: () => ctx.title,
    modifiedAt: () => ctx.modified,
    workingDirectories: () => [uriOf(cwd), ...ctx.additionalDirectories.map((one) => uriOf(one))],

    sessionState: () => ({
      // No `resource`: it is declared on `SessionSummary` and not on
      // `SessionState`, and a client subscribed to this channel named it.
      provider: 'claude',
      title: ctx.title,
      status: ctx.status(),
      lifecycle: 'ready',
      defaultChat: chatUri,
      chats: [{ resource: chatUri, title: ctx.title }],
      workingDirectories: [uriOf(cwd), ...ctx.additionalDirectories.map((one) => uriOf(one))],
      customizations: ctx.customizations,
      /*
       * The schema *and* what is in force.
       *
       * A client reads `config.schema.properties` to know which controls to
       * draw and `config.values` to know where each one sits - so a session
       * without this has no permission control, no model picker and no
       * effort control, which is what it had.
       */
      config: {
        schema: options.schema?.() ?? { type: 'object', properties: {} },
        values: { ...ctx.config, ...(ctx.chosen ? { model: ctx.chosen } : {}) },
      },
      /*
       * The model this session is on, under `_meta` because the protocol has
       * no field for it.
       *
       * `SessionState` declares none: `UsageInfo.model` says what some past
       * turn ran on and `ModelSelection` says what a client asked for, and
       * neither answers "what is this session on now" before a turn exists.
       * `_meta` is the protocol's own escape hatch, and a client reading
       * `_meta['ahpd.model']` knows it is reading an extension - where a bare
       * `model` beside `title` and `provider` reads like a declared field,
       * which is a mistake somebody has already made with this one.
       */
      ...(ctx.chosen ?? str(bag(ctx.init).model)
        ? { _meta: { 'ahpd.model': (ctx.chosen ?? str(bag(ctx.init).model)) as string } }
        : {}),
      // Set only while something is wanted. A key that is always present and
      // sometimes empty is a client that has to guess which it is.
      ...(needed().length > 0 ? { inputNeeded: needed() } : {}),
    }),

    chatState: () => ({
      resource: chatUri,
      title: ctx.title,
      status: ctx.status(),
      modifiedAt: ctx.modified,
      // A chat's own set, which may be narrower than its session's: the
      // process is rooted at the same place, and which additional directories
      // it was given is this chat's to say.
      workingDirectories: [uriOf(cwd), ...ctx.additionalDirectories.map((one) => uriOf(one))],
      // Every turn this chat holds. A resumed session can be seeded with
      // hundreds of them, and the host cuts the window a subscribe asks for.
      turns: ctx.turns,
      ...(ctx.active ? { activeTurn: ctx.active } : {}),
      ...(ctx.draft !== undefined ? { draft: ctx.draft } : {}),
      // Said rather than left to a default: `Full` is what a client assumes
      // when the field is absent, and assuming it is not the same as being
      // told. Every chat here is one somebody can type into.
      interactivity: 'full',
    }),

    /**
     * The client said the turn has begun, so reduce it and get to work.
     *
     * Write-ahead: the turn is real the moment the client says so, and the
     * host's job is to make it true rather than to decide whether it may.
     */

    close: (reason) => {
      /*
       * Stopped to be started again, the session ends what its clients hold of
       * it: each entry it raised comes down, its workers' turns and its own
       * turn end cancelled. The session that starts behind it runs none of
       * them, and its clients go on holding this chat's state. The reference
       * host says a chat's running turn cancelled when it stops that chat's
       * work. A session being disposed tells nobody anything.
       * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L118
       * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentSideEffects.ts#L1467-L1482
       */
      if (reason === 'stopping') {
        for (const one of [...ctx.pending.values()]) {
          ctx.pending.delete(one.id);
          one.settle({ behavior: 'deny', message: 'The session was stopped' });
          ctx.inputNeededRemoved(one.id);
        }
        for (const [callId, running] of ctx.onServer) {
          if (running.blocked) ctx.inputNeededRemoved(`toolAuthentication:${ctx.options.chatUri}:${running.turnId}:${callId}`);
        }
        for (const scope of [...ctx.scopes.values()]) {
          if (scope.parent !== '' && scope.chat !== undefined) ctx.endSubagent(scope.parent, 'cancelled');
        }
        const turn = ctx.active;
        if (turn !== undefined) {
          turn.state = 'cancelled';
          const attempt = Date.now() - ctx.startedAt;
          turn.duration = (ctx.resumedFrom?.duration ?? 0) + attempt;
          ctx.resumedFrom = undefined;
          ctx.clearPendingToolCalls(turn);
          ctx.turns.push(turn);
          ctx.active = undefined;
          ctx.emit('chat', { type: 'chat/turnCancelled', turnId: turn.id, duration: attempt });
        }
      }
      ctx.disposed = true;
      servers.unwatch();
      ctx.completed.clear();
      ctx.pastLines.clear();
      ctx.spawning.clear();
      ctx.background.clear();
      // What was running and what each chat was told about it. A session being
      // disposed tells nobody anything.
      ctx.taskInfo.clear();
      ctx.backgroundTasks.clear();
      ctx.told.clear();
      // And the output terminals a background shell wrote into, which go with
      // the session that made them rather than being finished without it.
      ctx.closeOutputs();
      // A worker still waiting for a spawn that will now never be recorded.
      for (const scope of ctx.scopes.values()) scope.waiting = undefined;
      ctx.pendingPromptDeferred?.();
      for (const one of [...ctx.pending.values()]) {
        ctx.pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The session was disposed' });
      }
      // And every preview those questions were carrying, which is the whole of
      // what this session was holding: nothing is left to preview a call with.
      ctx.settleEdits();
      ctx.releaseCalls('The session was disposed');
      try { rmSync(ctx.initScript, { force: true }); }
      catch { /* a script that was never written */ }
      ctx.query?.close();
      /*
       * The query's cleanup, which `close` starts and does not return: it
       * settles once the CLI's process has exited, or after the SDK's own bound.
       * A session whose first send never came has no CLI to wait for.
       */
      const disposed = (ctx.query as unknown as { [Symbol.asyncDispose]?: () => Promise<void> } | undefined)?.[Symbol.asyncDispose]?.();
      const exited = Promise.resolve(disposed).catch(() => undefined);
      /*
       * Kept under each conversation id this CLI could write until it has
       * exited, so a session that starts a conversation under one of them
       * waits for it first (`startQuery`).
       */
      const exits = options.exits;
      if (exits !== undefined && ctx.query !== undefined) {
        for (const id of new Set([ctx.sdkSessionId, options.chatId ?? idOf(options.uri)])) {
          if (id === undefined) continue;
          exits.set(id, exited);
          void exited.then(() => { if (exits.get(id) === exited) exits.delete(id); });
        }
      }
      return exited;
    },
  };
  ctx.self = self;
  return self;
}
