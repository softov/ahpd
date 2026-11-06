/**
 * One cofold session, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, the cofold `run()` behind a turn, and the translation of that
 * run's events into the `chat/*` actions a client already knows. The
 * event-to-action decisions themselves live in `mapping.ts` and the host tool
 * wrapping in `tools.ts`; this file is the lifecycle around them.
 *
 * Rules the protocol requires of anything emitting chat actions, kept here
 * the way the other backends keep them:
 *
 * - `chat/turnStarted` comes first, then a response part is opened, and only
 *   then may a delta stream into it.
 * - The running turn is `activeTurn` and is not in `turns`; it moves there
 *   when it completes.
 * - A turn carries both sides: `message.text` is what was said and
 *   `responseParts` is what the agent answered.
 */

import type { ModelInfo, Store } from '@cofold/agents';
import { bag, ensureWorkspacelessScratchDir, idOf, reason, str, uriOf } from '@ahpd/sdk';
import type { Bag, Chosen, Session, Start } from '@ahpd/sdk';
import { rowOf, storeOf } from './agent.js';
import type { CofoldOptions, Held } from './agent.js';
import { harnessConfig } from './config.js';
import type { HarnessConfig } from './config.js';
import type { OpenRequest } from './mapping.js';
import type { SessionContext } from './context.js';
import { createTurnAgent } from './turnagent.js';
import { createRuns } from './runs.js';
import { createPauses } from './pauses.js';
import { createTurns, partsFor } from './turns.js';

/**
 * The cofold session id an AHP session URI names.
 *
 * The client names the channel and cofold names the transcript; the two are
 * one conversation, so the id is derived in one place rather than a channel
 * URI handed to a store keyed by ids. The id is what follows the scheme,
 * whichever scheme the host holds the session under, and a URI already
 * stripped of its scheme is left alone, which is what a `resume` carries.
 */
export const sessionIdOf = (uri: string): string => idOf(uri);

/**
 * What a turn is built from, out of the options, and what a record may change
 * between two of them.
 *
 * A record's store, its machine's configuration directory and an embedder's
 * adapter and policy are chosen when the record is opened: a store that moved
 * under a running session would lose the conversation it is writing, and a
 * policy is what the session's controls were drawn from. These are the rest.
 */
const LIVE_KEYS = ['model', 'baseUrl', 'apiKey', 'instructions', 'resource', 'autoCompactTokens', 'tools'] as const;

/**
 * One conversation over a cofold agent.
 *
 * `options` is the backend's identity and wiring: the provider it was
 * registered under, the store, and the model factory a session's settings
 * feed. `start` is what this particular session was told. Everything after
 * this is the turn lifecycle.
 */
export function cofoldSession(
  options: CofoldOptions,
  start: Start,
  sharedStore?: Store,
  harness: HarnessConfig = harnessConfig(),
  /*
   * What the endpoint this session is pointed at serves, in the backend's own
   * catalogue. The backend shares one cache across its sessions, so a session
   * answers the same list a picker was drawn from rather than a second one.
   */
  catalogue: (settings: Record<string, unknown>, credentials: Record<string, string>) => ModelInfo[] =
    () => [],
  /*
   * What the backend holds for a turn's model: the provider it read the
   * catalogue through and what that catalogue said. A session built by a
   * caller that named none has nothing, and its turns build an adapter of
   * their own.
   */
  held?: Held,
  /**
   * Where each turn of the conversation this session resumes ended, as the
   * backend's last read of it named them, by turn id.
   */
  seedEnds?: ReadonlyMap<string, string>,
): Session {
  const provider = options.provider ?? 'cofold';
  /**
   * The cofold session this chat reads and writes: the conversation it
   * resumes, a fork's copy or a truncated conversation included, which the
   * agent's `create` made in the store first; otherwise the id the host named,
   * the chat's own where it has one and the session's otherwise, or the one
   * the URI spells.
   */
  const sessionId = start.resume ?? start.chatId ?? sessionIdOf(start.uri);
  /**
   * The directory the agent works in: the host's when it named one, and a
   * scratch folder of the session's own otherwise, as VS Code's agents run a
   * session with no workspace.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1564-L1570
   */
  const where = start.workingDirectory ?? ensureWorkspacelessScratchDir(start.uri);
  /**
   * The store every turn of this session shares.
   *
   * `cofoldAgent` builds one for the whole backend, so the catalogue and the
   * conversation read the same store; a caller that named none - the export
   * is public - gets one of its own, which is what a single session had.
   */
  const store = sharedStore ?? storeOf(options);

  /**
   * Read the record again, and put what it says now on the options a turn runs
   * on.
   *
   * The turn already running is not touched: a session reads this at the start
   * of a turn, so an edit lands on the next one and a turn that is streaming
   * ends on what it started with. A record that can no longer be used - a key
   * the vault would not read back, a form the kind no longer describes - comes
   * back as a sentence, which the turn answers instead of running.
   *
   * The sentence names the record and never what it holds: the config it was
   * built from has each key already read from the vault, and that is exactly
   * what must not reach a client.
   */
  const refreshOptions = (): string | undefined => {
    const live = options.recordOf;
    if (live === undefined) return undefined;
    let now: CofoldOptions;
    try {
      now = live();
    }
    catch (error) {
      return `${provider}: the record cannot be used: ${reason(error)}`;
    }
    const holding = options as unknown as Record<string, unknown>;
    const read = now as unknown as Record<string, unknown>;
    for (const key of LIVE_KEYS) {
      if (read[key] === undefined) delete holding[key];
      else holding[key] = read[key];
    }
    return undefined;
  };

  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  /**
   * The file each open writing call named, by the model's own call id.
   *
   * A call is announced with `before` and finished with `after`, and the id is
   * the only thing that survives between the two; an entry that is still here
   * when the turn ends is one whose tool never reported a result, which is a
   * call that was denied or a run that was stopped.
   */
  const editing = new Map<string, string>();

  /**
   * What a client is being asked about, by the run's own request id.
   *
   * One row per request rather than one for the turn, because a run can pause
   * again after each answer and the second request must not overwrite the
   * first while it is still open.
   */
  const pending = new Map<string, OpenRequest>();
  /**
   * Where each turn ended, in cofold's own message ids.
   *
   * `forkPoint` and `endPoint` are asked synchronously and a store read is
   * not, so the id is read once when a watched turn ends - before the client
   * is told it ended - and kept here for the two methods to answer from. A turn
   * the session opens with takes the point the backend's read of the store
   * named for it; the seed holds the turns a fork or a rewind kept. A turn
   * with no entry is one nobody named a point for, which makes the host offer
   * no cut at it: a point nobody can name is worse than none.
   */
  const seeded = new Set((start.seed ?? []).map((turn) => String(turn.id)));
  const points = new Map<string, string>([...seedEnds ?? []].filter(([turnId]) => seeded.has(turnId)));
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;
  /**
   * The config values in force, by key.
   *
   * `session/configChanged` merges into this, and the agent for the next turn
   * is built from it, so a session-mutable key changes what runs rather than
   * being recorded and ignored.
   */
  const values: Record<string, unknown> = { ...start.settings };

  /*
   * The chat's `modifiedAt`, held as the protocol's reducer moves it, so a
   * client that subscribes reads what one that followed the actions holds.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
   */
  const setModifiedAt = (at: string): void => { ctx.modified = at; };

  const ctx = {
    options,
    start,
    harness,
    provider,
    sessionId,
    where,
    store,
    held,
    turns,
    editing,
    pending,
    points,
    values,
    setModifiedAt,
    refreshOptions,
    offered: start.tools ?? [],
    active: undefined,
    pendingTurns: [] as SessionContext['pendingTurns'],
    replaced: new Set<string>(),
    withdrawn: new Set<string>(),
    handle: undefined,
    activeMapping: undefined,
    cancelRequested: false,
    error: undefined,
    title: 'Cofold session',
    provisional: false,
    modified: new Date().toISOString(),
    disposed: false,
    opening: undefined,
    paused: undefined,
    resumedFrom: undefined,
    steering: undefined,
  } as SessionContext;

  const { methods: toolMethods, ...turnAgent } = createTurnAgent(ctx);
  Object.assign(ctx, turnAgent);

  Object.assign(ctx, createTurns(ctx));
  Object.assign(ctx, createRuns(ctx));
  const { methods: answerMethods, ...pauses } = createPauses(ctx);
  Object.assign(ctx, pauses);

  /*
   * A resumed conversation may hold a paused run, which has to be known before
   * the first turn reads the session. Nothing else in the session reads the
   * store first, so this is the one deferral. A lookup the store fails runs
   * the turns all the same, on the conversation as the store holds it.
   */
  if (start.resume !== undefined && !ctx.disposed) {
    const pending = ctx.findPaused();
    ctx.opening = pending;
    const settledOpening = (): void => { if (ctx.opening === pending) ctx.opening = undefined; };
    void pending.then(settledOpening, settledOpening);
  }

  /** The model a client picked, taken by the next send: cofold keeps a model it took. */
  let chosen: Chosen | undefined;

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    /**
     * The models this session's endpoint serves, or the one it was told to run on.
     *
     * The backend's catalogue for the endpoint and key in force is the real
     * answer - what a picker was drawn from - and it is what the host learns
     * from, so answering a single row here would shrink a list the user already
     * saw. Until the endpoint has answered, the configured model is the honest
     * answer: a session that chose nothing and has no default is one that cannot
     * answer a turn, and an empty list is the form of that.
     */
    models: () => {
      const listed = catalogue(values, start.credentials ?? {}).map(rowOf);
      if (listed.length > 0) return listed;
      const id = str(values.model) ?? options.model ?? options.adapter?.modelId;
      return id === undefined ? [] : [{ id, name: id }];
    },
    agentId: () => sessionId,
    /*
     * Where a fork and a rewind cut, in cofold's own message ids: the last
     * message of the turn, as the run that wrote it recorded it or the read of
     * the store named it, as an agent that offers a fork forks at any turn that
     * ended, restored ones included. A turn nobody named a point for answers
     * nothing, which makes the host offer no cut at it rather than one that
     * fails when it is used.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L882-L888
     */
    forkPoint: (turnId) => points.get(turnId),
    endPoint: (turnId) => points.get(turnId),
    customizations: () => start.seedCustomizations ?? [],
    allTurns: () => turns,
    status: ctx.status,
    /*
     * Nothing: a chat's activity is a wait before its turn can run, as VS Code's
     * host says one, and a turn here runs once the host hands it over, its
     * thinking, its tools and its questions shown in its own parts.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724
     */
    activity: () => undefined,
    title: () => ctx.title,
    /*
     * A title a local command suggests, taken while the session has none of its
     * own or holds an earlier one of these, and said, as VS Code's host seeds
     * one; the first real message's title replaces it.
     */
    seedTitle: (said) => {
      if (said === '' || (ctx.title !== 'Cofold session' && !ctx.provisional) || said === ctx.title) return;
      ctx.title = said;
      ctx.provisional = true;
      start.emit('session', { type: 'session/titleChanged', title: said });
    },
    modifiedAt: () => ctx.modified,
    workingDirectories: () => [uriOf(where)],

    sessionState: () => ({
      // No `resource`: it is declared on `SessionSummary` and not on
      // `SessionState`, and a client subscribed to this channel named it.
      provider,
      title: ctx.title,
      status: ctx.status(),
      lifecycle: 'ready',
      defaultChat: start.chatUri,
      chats: [{ resource: start.chatUri, title: ctx.title }],
      workingDirectories: [uriOf(where)],
      customizations: start.seedCustomizations ?? [],
      /*
       * What a client is being asked - the person's questions and the calls a
       * client has to run - so a session channel a client subscribed to
       * before one was raised still shows it and the status that carries it.
       * The entries are the ones the set actions carried.
       */
      ...(ctx.needed().length > 0 ? { inputNeeded: ctx.needed() } : {}),
      // The schema *and* what is in force: a client reads
      // `config.schema.properties` for the controls and `config.values` for
      // where each one sits.
      config: { schema: start.schema(), values: { ...values } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title: ctx.title,
      status: ctx.status(),
      modifiedAt: ctx.modified,
      turns,
      ...(ctx.active !== undefined ? { activeTurn: ctx.active } : {}),
      ...(draft !== undefined ? { draft } : {}),
    }),

    sendMessage: (turnId, text, from, attachments, turnOptions) => {
      const model = chosen;
      chosen = undefined;
      ctx.beginTurn(turnId, text, model, from, attachments, turnOptions);
    },

    changeModel: (model) => { chosen = model; },
    // cofold runs one agent, its own, so an agent picked is kept by nothing.
    changeAgent: () => {},

    /**
     * Run the latest turn again, without adding a message.
     *
     * What `chat/turnResume` asks for, answered by the turn area once the
     * session has opened: the turn is reopened as it was, and the run a
     * restart left paused continues on its question, or the turn's prompt
     * runs again under the same id after the store is cut back to the turn
     * before it.
     */
    resumeTurn: async (turnId) => {
      await ctx.opening?.catch(() => undefined);
      if (!ctx.resumeTurn(turnId)) throw new Error(`${turnId} is not a turn this backend can run again`);
    },

    /**
     * Stop the running turn, and drop everything held of the turns behind it.
     *
     * The cancel reaches cofold's `RunHandle.cancel`, and the run's own
     * `run.finished` (a cancelled outcome) is what reports the turn's end, once.
     * The turns handed behind it go with the steering the run was handed, as
     * the reference stop aborts the agent's work in flight and drops what waits
     * behind it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1946-L1954
     */
    abort: () => {
      ctx.pendingTurns.length = 0;
      ctx.steering = undefined;
      if (ctx.active === undefined || ctx.cancelRequested) return;
      ctx.cancelRequested = true;
      ctx.abort('the client stopped the turn');
    },

    /**
     * Put a message into the running turn.
     *
     * cofold's own word for it is a steer: a message appended to the
     * transcript before the next model step. Answered as the reference agents
     * answer a steering message: `false` while the turn's run has not started
     * or has settled, which has the host hand it again on the turn's next
     * action, and a promise that answers `true` once the model's transcript
     * holds it, when its removal is said, or `false` when the run settled
     * before a step read it, handing it back for the host to steer the turn
     * that runs then or to run next.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1955
     *
     * A run waiting on a person still takes a steer, which it reads after the
     * answer; a run that settled takes none, so a message a settled run gave
     * back goes to the run that comes next.
     *
     * A correction with something attached is read the way a turn's own message
     * is, on the model the running turn was built on - the turn is the one that
     * answers, and a picture it cannot take would fail it. cofold takes the
     * text and then the parts, and the first part is always that text, so only
     * what follows it is handed over.
     */
    sendSteeringMessage: ({ id, text, attachments, from }) => {
      const live = ctx.handle;
      const status = live?.status();
      if (live === undefined || (status !== 'running' && status !== 'awaiting')) return false;
      const message: Bag = {
        text,
        origin: from?.origin ?? { kind: 'user' },
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
      };
      ctx.steering = { id, message };
      const submitted = attachments === undefined || attachments.length === 0
        ? live.submit({ type: 'steer', text })
        : partsFor(text, attachments, ctx.supportsVision())
          .then((parts) => live.submit({ type: 'steer', text, parts: parts.slice(1) }));
      return submitted.then(
        () => {
          // Read by the model, so it stays the run's whatever a client asked;
          // one a client took back is gone from every client already.
          if (ctx.withdrawn.delete(id)) return true;
          if (ctx.steering?.id === id) ctx.steering = undefined;
          start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id });
          return true;
        },
        () => {
          ctx.withdrawn.delete(id);
          if (ctx.steering?.id === id) ctx.steering = undefined;
          return false;
        },
      );
    },

    /*
     * A steering message a client took back after the host handed it here:
     * one cofold's submit still holds is answered nowhere when the run gives it
     * back, since `RunHandle.submit` takes approve, deny, answer, steer and
     * cancel and none of them takes a steer back. One the model read stays in
     * its turn. The host has said the removal.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1950-L1955
     */
    withdrawSteeringMessage: (id) => {
      if (ctx.steering?.id === id) {
        ctx.withdrawn.add(id);
        ctx.steering = undefined;
      }
    },

    // The draft the host said, held for the chat's state.
    setDraft: (next) => { draft = next; },

    ...answerMethods,

    /**
     * The tools on offer, replaced whole.
     *
     * The host calls this when a client announces what it provides or stops
     * being active, which is the only thing that moves this list after the
     * session is built. Replacing is what makes a tool taken away able to go.
     * It always answers true: there is no declaration to re-send, because an
     * agent is built per turn from this list, so the next turn simply gets
     * the new one.
     */
    setTools: async (tools) => {
      ctx.offered = [...tools];
      return true;
    },

    ...toolMethods,

    /*
     * Take a config value. A key in the schema is kept and applied to the
     * next turn's agent; anything else is refused in this backend's words,
     * because the host reads the schema for how a key behaves and knows
     * nothing about what one means.
     */
    setConfig: (key, value) => {
      const declared = bag(bag(start.schema()).properties);
      if (declared[key] === undefined) return `${provider}: ${key} is not a config key this backend takes`;
      if (typeof value !== 'string') return `${provider}: ${key} takes a string`;
      values[key] = value;
      return true;
    },

    // Nothing here has a runtime switch and there are no MCP servers, so all
    // three refuse. False is a real answer: a control that reported success
    // and changed nothing would be worse than one that says no.
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    settings: () => ({ ...values }),

    /*
     * A host that only lets the session go leaves a run paused on a person
     * where it is: detached, its request open in the store for a later resume,
     * which is what cofold's `detach` is for, a host that stops caring about a
     * pause. A session being deleted, and a run still working, are cancelled.
     * `RunHandle.detach` in npm://@cofold/agents@0.4.0: "What a host that stops
     * caring about a pause calls, so the run is not held here."
     */
    close: (reason = 'dispose') => {
      ctx.disposed = true;
      if (reason === 'stopping' && ctx.handle?.status() === 'awaiting') {
        ctx.handle.detach();
        return;
      }
      ctx.abort('the session closed');
    },
  };
}
