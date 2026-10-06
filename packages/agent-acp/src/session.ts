/**
 * One ACP session, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, one spawned ACP server behind a turn, and the translation of
 * that server's notifications into the `chat/*` actions a client already
 * knows. The update-to-action decisions themselves live in `mapping.ts`; this
 * file is the lifecycle around them, and the connection in `connection.ts`.
 *
 * Rules the protocol requires of anything emitting chat actions, kept here the
 * way the other backends keep them:
 *
 * - `chat/turnStarted` comes first, then a response part is opened, and only
 *   then may a delta stream into it.
 * - The running turn is `active` and is not in `turns`; it moves there when it
 *   completes.
 * - A turn carries both sides: `message.text` is what was said and
 *   `responseParts` is what the agent answered.
 *
 * A member this task cannot honestly support - a fork, a rewind, a live config
 * swap, a permission question - is left out or answered with the empty answer
 * the interface documents. Nothing throws over a capability this bridge does
 * not have yet.
 */

import { resolve } from 'node:path';
import { Status, uriOf } from '@ahpd/sdk';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { bag, UNTITLED } from './session/common.js';
import { createConfig } from './session/config.js';
import type { SessionContext } from './session/context.js';
import { createHandlers } from './session/handlers.js';
import { createOpening } from './session/opening.js';
import { createQueue } from './session/queue.js';
import { createTurn } from './session/turn.js';
import type { AcpOptions, AcpTurn, ConfirmationOption, PermissionAnswer, WatchedSession, WatchedTurn } from './types.js';

/**
 * How long a server is given to answer `session/close` before the connection
 * goes anyway.
 *
 * The answer is what says the server let go of the session, so a close that did
 * not wait would kill a process half way through releasing it.
 */
const CLOSE_GRACE_MS = 1000;

/**
 * One conversation over one ACP server.
 *
 * `options` is the backend's identity and wiring; `start` is what this
 * particular session was told. The server is spawned lazily, on the first
 * turn, so a session somebody opened and never used costs no subprocess.
 */
export function acpSession(options: AcpOptions, start: Start): Session {
  const provider = options.provider ?? 'acp';
  const emit = start.emit;
  /*
   * The directory the server works in.
   *
   * The client's choice wins, then the package's, then the daemon's own: a
   * session resumed or continued in another directory is where the client said
   * it is, and a server that was pointed somewhere says so on `session/new`.
   */
  const where = start.workingDirectory ?? options.cwd ?? process.cwd();

  /**
   * Whether a path is one this session was given to work in.
   *
   * Both sides are resolved first, so a path that climbs out of a directory
   * with `..` is judged by where it lands rather than by how it was written.
   */
  const directories = [where, ...(start.additional ?? [])].map((one) => resolve(one));
  const inside = (path: string): boolean => {
    const full = resolve(path);
    return directories.some((dir) => full === dir || full.startsWith(`${dir}/`));
  };

  /** What it is doing, or nothing while it is idle. */
  let activity: string | undefined;
  let modified = new Date().toISOString();
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;

  const touch = (): void => {
    modified = new Date().toISOString();
    if (ctx.record !== undefined) ctx.record.modifiedAt = modified;
  };

  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /**
   * `SessionStatus`: 8 is in progress, 4 waits on a person and 1 is idle.
   *
   * A permission the server is blocked on is the session waiting for
   * somebody, which is what a client draws the input request from.
   */
  const status = (): number => (ctx.permissions.size > 0 ? Status.InputNeeded
    : ctx.active !== undefined ? Status.InProgress
      : ctx.failed !== undefined ? Status.Error
        : Status.Idle);

  /*
   * The shared state, and then each area's own members assigned onto it.
   *
   * Cast through `unknown` because the literal is built in two steps and the
   * cast is checked before the second one runs: every area's members arrive
   * from the `Object.assign` below, none of them before.
   */
  const ctx = {
    options,
    start,
    provider,
    emit,
    where,
    inside,
    touch,
    doing,
    status,
    settings: { ...start.settings },
    turns: [...(start.seed ?? [])],
    seeds: [...(start.seedCustomizations ?? [])],
    commands: [],
    modes: undefined,
    active: undefined,
    mapping: undefined,
    cumulative: undefined,
    live: undefined,
    acpSessionId: undefined,
    closes: false,
    takes: undefined,
    replay: [],
    loading: false,
    opening: undefined,
    cancelRequested: false,
    closed: false,
    failed: undefined,
    title: UNTITLED,
    renamed: false,
    queued: [],
    record: undefined,
    watchedTurn: undefined,
    permissions: new Map(),
    terminals: new Map(),
  } as unknown as SessionContext;

  const { settings, turns, seeds, replay, queued, permissions, terminals } = ctx;

  Object.assign(ctx, createConfig(ctx));
  Object.assign(ctx, createHandlers(ctx));
  Object.assign(ctx, createOpening(ctx));
  Object.assign(ctx, createTurn(ctx));
  Object.assign(ctx, createQueue(ctx));

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    models: ctx.models,
    agentId: () => ctx.acpSessionId,
    customizations: () => [...seeds, ...ctx.commands],
    allTurns: () => turns,
    status,
    activity: () => activity,
    title: () => ctx.title,
    /*
     * A person's rename, which the host announces and this only keeps. The
     * flag is the whole of what a title needs here: the protocol has no rename
     * of its own, so there is nothing to say to the server.
     */
    setTitle: (said) => {
      if (said === '') return;
      ctx.title = said;
      ctx.renamed = true;
      if (ctx.record !== undefined) ctx.record.title = said;
      touch();
    },
    modifiedAt: () => modified,
    workingDirectories: () => [uriOf(where)],

    sessionState: () => ({
      resource: start.uri,
      provider,
      title: ctx.title,
      status: status(),
      lifecycle: 'ready',
      defaultChat: start.chatUri,
      chats: [{ resource: start.chatUri, title: ctx.title }],
      workingDirectories: [uriOf(where)],
      customizations: [...seeds, ...ctx.commands],
      ...(activity !== undefined ? { activity } : {}),
      // The schema *and* what is in force: a client reads
      // `config.schema.properties` for the controls and `config.values` for
      // where each one sits. The schema carries the server's modes once they
      // are known, so `permissionMode` has an enum exactly when it can have one.
      config: { schema: ctx.schemaOf(), values: { ...settings } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title: ctx.title,
      status: status(),
      modifiedAt: modified,
      turns,
      ...(ctx.active !== undefined ? { activeTurn: ctx.active } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(draft !== undefined ? { draft } : {}),
      queuedMessages: queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    begin: ctx.begin,

    ran: ctx.ran,

    /**
     * Stop the running turn.
     *
     * The ACP cancel notification is what a server stops on, and the `cancelled`
     * stop reason it answers the prompt with is what emits `chat/turnCancelled`
     * exactly once. This must not send one of its own, or a client sees two.
     *
     * The permissions are answered before it goes, because a server told to stop
     * while it is blocked on a question of this client's is a server that never
     * gets past the question.
     */
    cancel: (turnId) => {
      const turn = ctx.active;
      if (turn === undefined || String(turn.id) !== turnId) return;
      ctx.cancelRequested = true;
      ctx.settlePermissions();
      doing('Cancelling');
      const connection = ctx.live;
      if (connection !== undefined && ctx.acpSessionId !== undefined) {
        // Fire and forget: the prompt's own resolution is what ends the turn.
        void connection.cancel(ctx.acpSessionId).catch(() => {});
      }
    },

    queue: ctx.queue,

    unqueue: ctx.unqueue,

    reorder: ctx.reorder,

    // Held by the session, so two people on one chat see each other's.
    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    confirm: ctx.confirm,

    /*
     * ACP asks no questions of its own here.
     *
     * Its only interactive request is `session/request_permission`, which is
     * the confirmation above; there is no question shape to answer, so an
     * answer names something this session never asked.
     */
    answer: () => {},

    setConfig: ctx.setConfig,

    // Nothing here has a runtime switch and there are no MCP servers, so all
    // three refuse. False is a real answer: a control that reported success
    // and changed nothing would be worse than one that says no.
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    settings: () => ({ ...settings }),

    close: async (): Promise<void> => {
      ctx.closed = true;
      /*
       * Everything anybody is still waiting on is let go first.
       *
       * A permission is a subprocess blocked on a promise, and a shell the
       * server asked for is a process this host opened: closing the connection
       * without answering either leaves the first hanging and the second
       * running under nobody.
       */
      for (const held of permissions.values()) held.settle('cancelled');
      permissions.clear();
      for (const held of terminals.values()) held.handle.release();
      terminals.clear();
      const connection = ctx.live;
      ctx.live = undefined;
      /*
       * The server is told first, where it advertised it can be told.
       *
       * A server that frees its own resources on `session/close` never gets to
       * do so if the pipe is closed under it mid-release, so the request goes
       * first and is given a bounded moment to be answered. Bounded rather than
       * awaited outright: a server that advertises the capability and never
       * answers it must not hold a close open.
       */
      const saying = connection !== undefined && ctx.closes && ctx.acpSessionId !== undefined
        ? Promise.race([
            connection.closeSession(ctx.acpSessionId).catch(() => {}),
            new Promise((resolve) => { setTimeout(resolve, CLOSE_GRACE_MS).unref(); }),
          ])
        : undefined;
      // The catalogue's record is deliberately kept: the server still holds the
      // conversation and the transcript a row opens onto is this process's own
      // record of it. Only the live connection goes.
      // A turn still open has nobody left to answer it.
      if (ctx.active !== undefined) ctx.finish(String(ctx.active.id), 'cancelled');
      // The connection goes last, and settles on the server's processes being
      // gone rather than on the request having been sent.
      await saying;
      await connection?.close();
    },
  };
}
