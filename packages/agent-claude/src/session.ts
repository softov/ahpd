import { rmSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { optionDefaults, storedSandbox } from './options.js';
import { tail, uriOf } from '@ahpd/sdk';
import type { Bag, BoundTool, Session } from '@ahpd/sdk';
import { bag, list, str } from './session/common.js';
import { createAsking } from './session/asking.js';
import { contributed, createClientTools } from './session/clienttools.js';
import { createConfig, listsOf } from './session/config.js';
import type { ClaudeSessionOptions, SessionContext } from './session/context.js';
import { createParts } from './session/parts.js';
import { createQuery } from './session/query.js';
import { createServers } from './session/servers.js';
import { createStream } from './session/stream.js';
import { createTurns } from './session/turns.js';
import { createWorkers } from './session/workers.js';

export { keptLabel } from './session/asking.js';
export { INTERNAL_AGENT, agentNameOf, customizationsOf } from './session/customizations.js';
export { EFFORT_LABELS, EFFORTS, permissionFor } from './session/config.js';
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

  const ctx = {
    options,
    emit,
    settings: { permissionMode: 'default', ...options.settings } as Record<string, unknown>,
    allowed: listsOf(options.settings?.permissions) ?? { allow: [], deny: [] },
    chosen: undefined as string | undefined,
    offering: [...(options.tools ?? [])] as BoundTool[],
    handle: undefined as unknown as ReturnType<typeof query>,
    active: undefined as Bag | undefined,
    title: str(bag(bag((options.seed ?? [])[0]).message).text)?.slice(0, 60) || 'New session',
    modified: new Date().toISOString(),
    activity: undefined as string | undefined,
    startedAt: 0,
    failed: undefined as string | undefined,
    ran: undefined as string | undefined,
    streaming: undefined as string | undefined,
    wake: undefined as (() => void) | undefined,
    closed: false,
    peers: [...(options.additional ?? [])] as string[],
    steering: undefined as Bag | undefined,
    running: undefined as string | undefined,
    agentId: options.resume as string | undefined,
    handshake: undefined as Bag | undefined,
    gone: undefined as string | undefined,
    customizations: [...(options.seedCustomizations ?? [])] as Bag[],
    offered: [] as { id: string; name: string }[],
    values: { ...optionDefaults(), ...options.preset, ...storedSandbox(options.settings) } as Bag,
    draft: undefined as Bag | undefined,
    beginning: undefined as string | undefined,
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
  Object.assign(ctx, asking);
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
  if (ctx.settings.shellInitScripts !== undefined) ctx.setShellInit(ctx.settings.shellInitScripts);

  /*
   * The host's own tools, as an MCP server the CLI does not have to find.
   *
   * `createSdkMcpServer` runs in this process rather than spawning anything,
   * so a host tool is a function call and not a subprocess. Named `ahp`
   * because that is what a client sees the tools attributed to. Declared once
   * at construction so `setMcpServers` keeps it: that call replaces the whole
   * set, and a set rebuilt without this would take the host's tools away.
   */
  if (ctx.offering.length > 0) ctx.declared.ahp = contributed(ctx.offering, ctx.ranByClient) as Bag;

  // ------------------------------------------------------------------ the run
  ctx.handle = ctx.startQuery(ctx.running, true);
  void ctx.describe().catch(() => {});

  void ctx.consume();

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

    models: () => ctx.offered,
    agentId: () => ctx.agentId,
    forkPoint: (turnId) => ctx.ends.get(turnId),
    endPoint: (turnId) => ctx.ends.get(turnId),

    customizations: () => ctx.customizations,
    allTurns: () => ctx.turns,
    activity: () => ctx.activity,
    title: () => ctx.title,
    modifiedAt: () => ctx.modified,
    workingDirectories: () => [uriOf(cwd), ...ctx.peers.map((one) => uriOf(one))],

    sessionState: () => ({
      // No `resource`: it is declared on `SessionSummary` and not on
      // `SessionState`, and a client subscribed to this channel named it.
      provider: 'claude',
      title: ctx.title,
      status: ctx.status(),
      lifecycle: 'ready',
      defaultChat: chatUri,
      chats: [{ resource: chatUri, title: ctx.title }],
      workingDirectories: [uriOf(cwd), ...ctx.peers.map((one) => uriOf(one))],
      customizations: ctx.customizations,
      // What it is doing, only while it is doing something. The protocol has
      // a session mirror its default chat's, which is where this is set.
      ...(ctx.activity !== undefined ? { activity: ctx.activity } : {}),
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
        values: { ...ctx.settings, ...(ctx.chosen ? { model: ctx.chosen } : {}) },
      },
      /*
       * The model this session is on, under `_meta` because the protocol has
       * no field for it.
       *
       * `SessionState` declares none: `UsageInfo.model` says what some past
       * turn ran on and `ModelSelection` says what a client asked for, and
       * neither answers "what is this session on now" before a turn exists.
       * `_meta` is the protocol's own escape hatch, and a client reading
       * `_meta.model` knows it is reading an extension - where a bare `model`
       * beside `title` and `provider` reads like a declared field, which is a
       * mistake somebody has already made with this one.
       */
      ...(ctx.chosen ?? str(bag(ctx.handshake).model)
        ? { _meta: { model: (ctx.chosen ?? str(bag(ctx.handshake).model)) as string } }
        : {}),
      // Set only while something is wanted. A key that is always present and
      // sometimes empty is a client that has to guess which it is.
      ...(ctx.pending.size > 0 ? { inputNeeded: [...ctx.pending.values()].map((one) => one.entry) } : {}),
      ...(ctx.failed ? { error: ctx.failed } : {}),
    }),

    chatState: () => ({
      resource: chatUri,
      title: ctx.title,
      status: ctx.status(),
      modifiedAt: ctx.modified,
      // A chat's own set, which may be narrower than its session's: the
      // process is rooted at the same place, and which peers it was given is
      // this chat's to say.
      workingDirectories: [uriOf(cwd), ...ctx.peers.map((one) => uriOf(one))],
      // The newest page. A resumed session can be seeded with hundreds of
      // turns, and the snapshot is what a client waits on before it draws.
      ...tail(ctx.turns),
      ...(ctx.active ? { activeTurn: ctx.active } : {}),
      ...(ctx.activity !== undefined ? { activity: ctx.activity } : {}),
      ...(ctx.draft !== undefined ? { draft: ctx.draft } : {}),
      // Said rather than left to a default: `Full` is what a client assumes
      // when the field is absent, and assuming it is not the same as being
      // told. Every chat here is one somebody can type into.
      interactivity: 'full',
      ...(ctx.steering !== undefined ? { steeringMessage: ctx.steering } : {}),
      queuedMessages: ctx.queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    /**
     * The client said the turn has begun, so reduce it and get to work.
     *
     * Write-ahead: the turn is real the moment the client says so, and the
     * host's job is to make it true rather than to decide whether it may.
     */

    close: () => {
      ctx.closed = true;
      ctx.ended.clear();
      ctx.pastLines.clear();
      ctx.answeredInputs.clear();
      ctx.spawning.clear();
      ctx.background.clear();
      // A worker still waiting for a spawn that will now never be recorded, and
      // a timer that would open its chat on a session nobody is listening to.
      for (const scope of ctx.scopes.values()) {
        if (scope.release !== undefined) clearTimeout(scope.release);
        scope.waiting = undefined;
      }
      ctx.wake?.();
      for (const one of [...ctx.pending.values()]) {
        ctx.pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The session was disposed' });
      }
      ctx.releaseCalls('The session was disposed');
      try { rmSync(ctx.initScript, { force: true }); }
      catch { /* a script that was never written */ }
      ctx.handle.close();
      /*
       * The query's cleanup, which `close` starts and does not return: it
       * settles once the CLI's process has exited, or after the SDK's own bound.
       */
      const disposed = (ctx.handle as unknown as { [Symbol.asyncDispose]?: () => Promise<void> })[Symbol.asyncDispose]?.();
      return Promise.resolve(disposed).catch(() => undefined);
    },
  };
  ctx.self = self;
  return self;
}
