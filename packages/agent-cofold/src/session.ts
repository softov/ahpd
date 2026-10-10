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
import { idOf, uriOf } from '@ahpd/sdk';
import type { Bag, Session, Start } from '@ahpd/sdk';
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

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

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
): Session {
  const provider = options.provider ?? 'cofold';
  /**
   * The cofold session this chat reads and writes.
   *
   * A fresh session and a plain resume are the id the host named - the chat's
   * own where it has one, and the session's otherwise - or the one the URI
   * spells. A rewind is that same id: AHP keeps the session and drops a tail.
   * A fork is the one case that does not continue what it was resumed with -
   * AHP forks a *chat* into another chat of the same session, so
   * `start.resume` names the conversation to copy from and the target has to
   * be a new one, or the fork would append to the conversation it was told to
   * preserve.
   */
  const sessionId = start.forkAt !== undefined
    ? crypto.randomUUID()
    : start.resume ?? start.chatId ?? sessionIdOf(start.uri);
  /** The directory the agent works in; the host's when it named one. */
  const where = start.workingDirectory ?? process.cwd();
  /**
   * The store every turn of this session shares.
   *
   * `cofoldAgent` builds one for the whole backend, so the catalogue and the
   * conversation read the same store; a caller that named none - the export
   * is public - gets one of its own, which is what a single session had.
   */
  const store = sharedStore ?? storeOf(options);

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
   * Where each watched turn ended, in cofold's own message ids.
   *
   * `forkPoint` and `endPoint` are asked synchronously and a store read is
   * not, so the id is read once when the turn ends - before the client is told
   * it ended - and kept here for the two methods to answer from. A turn this
   * process did not watch has no entry, which is what makes the host offer no
   * cut at it: a point nobody can name is worse than none.
   */
  const points = new Map<string, string>();
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  const queued: Bag[] = [];
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;
  /**
   * The config in force, by key.
   *
   * `session/configChanged` merges into this, and the agent for the next turn
   * is built from it, so a session-mutable key changes what runs rather than
   * being recorded and ignored.
   */
  const settings: Record<string, unknown> = { ...start.settings };

  const touch = (): void => { ctx.modified = new Date().toISOString(); };

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
    queued,
    settings,
    touch,
    offered: start.tools ?? [],
    active: undefined,
    handle: undefined,
    activeMapping: undefined,
    cancelRequested: false,
    failed: undefined,
    title: 'Cofold session',
    modified: new Date().toISOString(),
    closed: false,
    opening: undefined,
    refused: undefined,
    activity: undefined,
  } as SessionContext;

  const { methods: toolMethods, ...turnAgent } = createTurnAgent(ctx);
  Object.assign(ctx, turnAgent);

  const { methods: queueMethods, ...turnOffers } = createTurns(ctx);
  Object.assign(ctx, turnOffers);
  Object.assign(ctx, createRuns(ctx));
  const { methods: answerMethods, ...pauses } = createPauses(ctx);
  Object.assign(ctx, pauses);

  /*
   * A resumed conversation may be paused, and a fork or a rewind has a cut to
   * make, and both have to land before the first turn reads the session.
   * Nothing else in the session reads the store first, so this is the one
   * deferral for all three.
   */
  if ((start.resume !== undefined || start.forkAt !== undefined || start.rewindAt !== undefined) && !ctx.closed) {
    const pending = (async (): Promise<void> => {
      await ctx.cut();
      if (start.resume !== undefined) await ctx.reopen();
    })();
    ctx.opening = pending;
    const settledOpening = (): void => { if (ctx.opening === pending) ctx.opening = undefined; };
    void pending.then(settledOpening, (why: unknown) => {
      // The refusal is kept rather than thrown into an unhandled rejection:
      // the turn paths read it and answer the client with it.
      ctx.refused = why instanceof Error ? why : new Error(String(why));
      settledOpening();
    });
  }

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
      const listed = catalogue(settings, start.credentials ?? {}).map(rowOf);
      if (listed.length > 0) return listed;
      const id = str(settings.model) ?? options.model ?? options.adapter?.modelId;
      return id === undefined ? [] : [{ id, name: id }];
    },
    agentId: () => sessionId,
    /*
     * Where a fork and a rewind cut, in cofold's own message ids.
     *
     * A turn this process did not watch run has no entry: it was read back off
     * a transcript, and cofold names a run's span rather than a turn's, so the
     * point is not something this session can promise. Answering nothing is
     * what makes the host offer no cut at that turn rather than offer one that
     * fails when it is used.
     */
    forkPoint: (turnId) => points.get(turnId),
    endPoint: (turnId) => points.get(turnId),
    customizations: () => start.seedCustomizations ?? [],
    allTurns: () => turns,
    status: ctx.status,
    activity: () => ctx.activity,
    title: () => ctx.title,
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
      ...(ctx.activity !== undefined ? { activity: ctx.activity } : {}),
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
      config: { schema: start.schema(), values: { ...settings } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title: ctx.title,
      status: ctx.status(),
      modifiedAt: ctx.modified,
      turns,
      ...(ctx.active !== undefined ? { activeTurn: ctx.active } : {}),
      ...(ctx.activity !== undefined ? { activity: ctx.activity } : {}),
      ...(draft !== undefined ? { draft } : {}),
      // The protocol's `PendingMessage` is `{ id, message }` and nothing else,
      // so the model a queued turn will run on stays in this session.
      queuedMessages: queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    begin: (turnId, text, model, from, attachments) =>
      ctx.beginTurn(turnId, text, model, from, undefined, attachments),

    ...queueMethods,

    /**
     * Stop the running turn.
     *
     * The cancel reaches cofold's `RunHandle.cancel`, and the run's own
     * `run.finished` (a cancelled outcome) is what emits `chat/turnCancelled`
     * exactly once. This must not send one of its own, or a client sees two.
     */
    cancel: (turnId) => {
      const turn = ctx.active;
      if (turn === undefined) return;
      if (turnId !== String(turn.id)) return;
      ctx.cancelRequested = true;
      ctx.stop('the client stopped the turn');
    },

    /**
     * Put a message into the running turn.
     *
     * cofold's own word for it is a steer: a message appended to the
     * transcript before the next model step. Answers whether there was a turn
     * to steer, because a chat with nothing running has nothing to inject
     * into.
     *
     * A correction with something attached is read the way a turn's own message
     * is, on the model the running turn was built on - the turn is the one that
     * answers, and a picture it cannot take would fail it. cofold takes the
     * text and then the parts, and the first part is always that text, so only
     * what follows it is handed over.
     */
    steer: (_id, text, attachments) => {
      const live = ctx.handle;
      if (live === undefined) return false;
      // Fire and forget: the answer is whether a turn was running, which is
      // known here, and the submit settles when the transcript takes it.
      if (attachments === undefined || attachments.length === 0) {
        void live.submit({ type: 'steer', text }).catch(() => {});
        return true;
      }
      void partsFor(text, attachments, ctx.takesImages())
        .then((parts) => live.submit({ type: 'steer', text, parts: parts.slice(1) }))
        .catch(() => {});
      return true;
    },

    // Held by the session, so two people on one chat see each other's.
    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      start.emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

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
      settings[key] = value;
      return true;
    },

    // Nothing here has a runtime switch and there are no MCP servers, so all
    // three refuse. False is a real answer: a control that reported success
    // and changed nothing would be worse than one that says no.
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    settings: () => ({ ...settings }),

    close: () => {
      ctx.closed = true;
      ctx.stop('the session closed');
    },
  };
}
