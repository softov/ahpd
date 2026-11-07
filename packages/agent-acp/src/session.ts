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
 * - A turn's start is the host's, said before the turn is sent here; a
 *   response part is opened before a delta streams into it.
 * - The running turn is `active` and is not in `turns`; it moves there when it
 *   completes.
 * - A turn carries both sides: `message.text` is what was said and
 *   `responseParts` is what the agent answered.
 *
 * A member this task cannot honestly support - a rewind, a live config swap, a
 * permission question - is left out or answered with the empty answer the
 * interface documents. Nothing throws over a capability this bridge does not
 * have yet.
 */

import { resolve, sep } from 'node:path';
import { ensureWorkspacelessScratchDir, statusOf, uriOf } from '@ahpd/sdk';
import type { Bag, Chosen, Session, Start } from '@ahpd/sdk';
import { bag, UNTITLED } from './session/common.js';
import { createClientCalls } from './session/clientcalls.js';
import { createConfig } from './session/config.js';
import type { Choice } from './session/config.js';
import type { SessionContext } from './session/context.js';
import { createHandlers } from './session/handlers.js';
import { createOpening } from './session/opening.js';
import { createTurn } from './session/turn.js';
import type { AcpOptions, AcpTurn, ConfirmationOption, PermissionAnswer, WatchedSession, WatchedTurn } from './types.js';

/**
 * How long a server is given to answer `session/close` before the connection
 * goes anyway, unless the record's `closeGraceMs` says otherwise.
 *
 * The answer is what says the server let go of the session, so a close that did
 * not wait would kill a process half way through releasing it.
 */
const CLOSE_GRACE_MS = 1000;

/**
 * One conversation over one ACP server.
 *
 * `options` is the backend's identity and wiring; `start` is what this
 * particular session was told. The session is answered once its server has
 * opened, so what the server offers is in the first state a client is served.
 *
 * `heardModes` is how this session tells its agent the modes its server named,
 * which the agent's schema lists until a later session hears others, and
 * `levels` is the agent's record of the thinking levels each model offers,
 * which this session adds to and lists its models with.
 */
export function acpSession(
  options: AcpOptions,
  start: Start,
  heardModes?: (modes: { id: string; name: string }[]) => void,
  levels: Map<string, Choice[]> = new Map(),
): Promise<Session> {
  const provider = options.provider ?? 'acp';
  const emit = start.emit;
  /*
   * The directory the server works in.
   *
   * The client's choice wins, then the package's: a session resumed or
   * continued in another directory is where the client said it is, and a
   * server that was pointed somewhere says so on `session/new`. A session
   * given neither works in a scratch folder of its own, as VS Code's agents
   * run a session with no workspace.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1564-L1570
   */
  const cwd = start.workingDirectory ?? options.cwd ?? ensureWorkspacelessScratchDir(start.uri);

  /**
   * Whether a path is one this session was given to work in.
   *
   * Both sides are resolved first, so a path that climbs out of a directory
   * with `..` is judged by where it lands rather than by how it was written.
   */
  const directories = [cwd, ...(start.additional ?? [])].map((one) => resolve(one));
  const inside = (path: string): boolean => {
    const full = resolve(path);
    // The system's separator: `resolve` answers `C:\work` on Windows, never `C:/work`.
    return directories.some((dir) => full === dir || full.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`));
  };

  let modified = new Date().toISOString();
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;

  /*
   * The chat's `modifiedAt`, held as the protocol's reducer moves it, so a
   * client that subscribes reads what one that followed the actions holds.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
   */
  const setModifiedAt = (at: string): void => {
    modified = at;
    if (ctx.record !== undefined) ctx.record.modifiedAt = at;
  };

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
    heardModes,
    levels,
    provider,
    emit,
    cwd,
    inside,
    setModifiedAt,
    /*
     * A permission the server is blocked on is the session waiting for
     * somebody, which is what a client draws the input request from, and a
     * question it asked is the same wait by another name.
     */
    status: (): number => statusOf({
      waiting: ctx.permissions.size > 0 || ctx.elicitations.size > 0,
      active: ctx.active !== undefined,
      failed: ctx.error !== undefined,
    }),
    offering: [...(start.tools ?? [])],
    values: { ...start.settings },
    turns: [...(start.seed ?? [])],
    seeds: [...(start.seedCustomizations ?? [])],
    commands: [],
    modes: undefined,
    active: undefined,
    pendingTurns: [],
    replaced: new Set<string>(),
    mapping: undefined,
    cumulative: undefined,
    live: undefined,
    acpSessionId: undefined,
    closes: false,
    loads: false,
    resumes: false,
    forks: false,
    promptCapabilities: undefined,
    replay: [],
    loading: false,
    opening: undefined,
    startedWith: '',
    cancelRequested: false,
    disposed: false,
    error: undefined,
    title: UNTITLED,
    renamed: false,
    provisional: false,
    record: undefined,
    watchedTurn: undefined,
    permissions: new Map(),
    terminals: new Map(),
    elicitations: new Map(),
  } as unknown as SessionContext;

  const { values, turns, seeds, replay, permissions, terminals } = ctx;

  Object.assign(ctx, createConfig(ctx));
  Object.assign(ctx, createHandlers(ctx));
  Object.assign(ctx, createOpening(ctx));
  Object.assign(ctx, createTurn(ctx));
  Object.assign(ctx, createClientCalls(ctx));

  /** The model a client picked, taken by the next send: the server keeps a model it took. */
  let chosen: Chosen | undefined;

  const session: Session = {
    uri: start.uri,
    chatUri: start.chatUri,

    models: ctx.models,
    agentId: () => ctx.acpSessionId,
    /*
     * Read from the handshake rather than from whether the id is set: this
     * bridge can name the conversation it is running, and a server that
     * advertised neither a load nor a resume is one that would start a new
     * conversation rather than reopen that. Either one counts, because both
     * hand the conversation back - a resume is simply the one that hands it
     * back without replaying it, which is what `open` chooses it for. False
     * until the server has spoken, which is also the honest answer - before
     * that, nothing here has a conversation to be moved.
     */
    resumable: () => ctx.loads || ctx.resumes,
    // A terminal the server opened whose process still runs is work the host cannot see.
    busy: () => [...terminals.values()].some((one) => one.exited !== true),
    customizations: () => [...seeds, ...ctx.commands],
    allTurns: () => turns,
    /*
     * What a fork copies through, which is the turn's own end.
     *
     * `session/fork` copies the whole conversation the server holds and takes
     * no cut, so there is no entry inside it for this bridge to name. The name
     * it answers with is the id the host gave the turn, which is what the fork
     * `open` is handed back and what it checks the conversation against.
     *
     * Only the last completed turn answers. A fork of an earlier one would
     * have to leave the turns after it behind, and this server cannot be asked
     * for that - so no control is offered for one, rather than one that fails
     * when somebody uses it.
     */
    forkPoint: (turnId) => {
      if (!ctx.forks) return undefined;
      const last = turns.at(-1);
      return last !== undefined && String(last.id ?? '') === turnId ? turnId : undefined;
    },
    status: () => ctx.status(),
    /*
     * Nothing: a chat's activity is a wait before its turn can run, as VS Code's
     * host says one, and a turn here runs once the host hands it over, its
     * thinking, its tools and its questions shown in its own parts.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11709-L11724
     */
    activity: () => undefined,
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
      ctx.provisional = false;
      if (ctx.record !== undefined) ctx.record.title = said;
    },
    /*
     * A title a local command suggests, taken while the session has none of its
     * own or holds an earlier one of these, and said, as VS Code's host seeds
     * one; the first real message's title replaces it.
     */
    seedTitle: (said) => {
      if (said === '' || ctx.renamed || (ctx.title !== UNTITLED && !ctx.provisional) || said === ctx.title) return;
      ctx.title = said;
      ctx.provisional = true;
      if (ctx.record !== undefined) ctx.record.title = said;
      emit('session', { type: 'session/titleChanged', title: said });
    },
    modifiedAt: () => modified,
    workingDirectories: () => [uriOf(cwd)],

    sessionState: () => {
      /*
       * What this session waits on: the permissions and questions the server
       * is blocked on and the calls it has out with its clients, which is what
       * a client connecting now draws each request from. The entries were
       * raised as actions while nobody was watching, and a session whose state
       * did not carry them would be one whose request only a client that was
       * there already could answer, as the pi and cofold sessions list theirs.
       *
       * Set only while there are any, so a key that is always present and
       * sometimes empty is not a thing a client has to guess about.
       */
      const needed = [...ctx.permissions.values(), ...ctx.elicitations.values()]
        .flatMap((one) => (one.entry === undefined ? [] : [one.entry]))
        .concat(ctx.calls.entries());
      return {
        // No `resource`: it is declared on `SessionSummary` and not on
        // `SessionState`, and a client subscribed to this channel named it.
        provider,
        title: ctx.title,
        status: ctx.status(),
        lifecycle: 'ready',
        defaultChat: start.chatUri,
        chats: [{ resource: start.chatUri, title: ctx.title }],
        workingDirectories: [uriOf(cwd)],
        customizations: [...seeds, ...ctx.commands],
        ...(needed.length > 0 ? { inputNeeded: needed } : {}),
        // The schema *and* what is in force: a client reads
        // `config.schema.properties` for the controls and `config.values` for
        // where each one sits. The schema carries the server's modes once they
        // are known, so `permissionMode` has an enum exactly when it can have one.
        config: { schema: ctx.schemaOf(), values: { ...values } },
      };
    },

    chatState: () => ({
      resource: start.chatUri,
      title: ctx.title,
      status: ctx.status(),
      modifiedAt: modified,
      turns,
      ...(ctx.active !== undefined ? { activeTurn: ctx.active } : {}),
      ...(draft !== undefined ? { draft } : {}),
    }),

    // The model is the one picked for this send.
    sendMessage: (turnId, text, from, attachments, turnOptions) => {
      const model = chosen;
      chosen = undefined;
      ctx.sendMessage(turnId, text, model, from, attachments, turnOptions);
    },

    changeModel: (model) => { chosen = model; },
    // An ACP server is asked as the agent it is, so an agent picked is kept by
    // nothing.
    changeAgent: () => {},

    /**
     * Stop the running turn, and drop the turns handed behind it, as the
     * reference stop aborts the agent's work in flight and drops what waits
     * behind it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1946-L1954
     *
     * The ACP cancel notification is what a server stops on, and the `cancelled`
     * stop reason it answers the prompt with is what reports the turn's end,
     * once. A turn still preparing ends before its prompt is sent.
     *
     * The permissions and the questions are answered before it goes, because a
     * server told to stop while it is blocked on one of this client's is a
     * server that never gets past it. A question is answered `cancel` rather
     * than declined: nobody said no, the asking simply stopped.
     *
     * And so are the calls out with clients, for the same reason: a client is
     * asked for one, the agent is blocked on the request it made for that call,
     * and neither is any longer anything this turn will finish.
     */
    abort: () => {
      ctx.pendingTurns.length = 0;
      if (ctx.active === undefined || ctx.cancelRequested) return;
      ctx.cancelRequested = true;
      ctx.settlePermissions();
      ctx.settleElicitations();
      ctx.calls.release('The turn was stopped');
      const connection = ctx.live;
      if (connection !== undefined && ctx.acpSessionId !== undefined) {
        // Fire and forget: the prompt's own resolution is what ends the turn.
        void connection.cancel(ctx.acpSessionId).catch(() => {});
      }
    },

    /*
     * The tools this session may offer, which the host replaces whole whenever
     * a client announces what it runs or stops being active.
     *
     * Kept because what a client provides is what a call the agent reports is
     * recognised by: the offering is the lookup a reported call's owner comes
     * from, and it has to be current before the next turn.
     */
    setTools: ctx.setTools,

    /*
     * The three the holder answers, spread on unchanged.
     *
     * Which client owns a call, which client may settle it, and what happens to
     * the calls of a client that goes: all of it is the holder's, and none of it
     * is about this bridge. These are what the host's own dispatch reads - a
     * client answering with `chat/toolCallComplete` is talking to the holder
     * through them - and the answer reaches the agent as the tool result of the
     * `tools/call` it is blocked on.
     */
    ...ctx.calls.methods,

    // The draft the host said, held for the chat's state.
    setDraft: (next) => { draft = next; },

    confirm: ctx.confirm,

    /*
     * The server's own question, answered from a client of the chat.
     *
     * `session/request_permission` is the confirmation above and is answered
     * through the call's own controls; `elicitation/create` is a form, which is
     * a question, so it is answered by the request id it was raised under.
     * False for an id nothing here is waiting on, which is what a host reads as
     * an answer to a question this session never asked.
     */
    answer: ctx.answerElicitation,

    setConfig: ctx.setConfig,

    // Nothing here has a runtime switch and there are no MCP servers, so all
    // three refuse. False is a real answer: a control that reported success
    // and changed nothing would be worse than one that says no.
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    settings: () => ({ ...values }),

    close: async (): Promise<void> => {
      ctx.disposed = true;
      /*
       * Everything anybody is still waiting on is let go first.
       *
       * A permission is a subprocess blocked on a promise, and a shell the
       * server asked for is a process this host opened: closing the connection
       * without answering either leaves the first hanging and the second
       * running under nobody. A question the server asked is the same promise
       * by another name, and is answered `cancel` for the same reason a stopped
       * turn's is.
       *
       * A client's call is the third of those. The agent is blocked on the
       * request it made for one, the client is holding an entry that is about to
       * be on no channel at all, and neither ends by being left alone.
       */
      for (const held of permissions.values()) held.settle('cancelled');
      permissions.clear();
      ctx.settleElicitations();
      ctx.calls.release('The session was closed');
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
            new Promise((resolve) => { setTimeout(resolve, ctx.options.closeGraceMs ?? CLOSE_GRACE_MS).unref(); }),
          ])
        : undefined;
      // The catalogue's record is deliberately kept: the server still holds the
      // conversation and the transcript a row opens onto is this process's own
      // record of it. Only the live connection goes.
      // A turn still open has nobody left to answer it.
      if (ctx.active !== undefined) ctx.endTurn(String(ctx.active.id), 'cancelled');
      // The connection goes last, and settles on the server's processes being
      // gone rather than on the request having been sent.
      await saying;
      await connection?.close();
    },
  };
  /*
   * The server is opened before the session is answered, so the state a
   * client is first served carries what the server offers, its modes, its
   * options and its models, as VS Code seeds a session's config and schema
   * before its first snapshot. It is built from what the record says now. An
   * open that fails, or a record that can no longer be used, is the first
   * turn's to say: that turn opens the server again, and ends with the
   * failure it meets.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2476-L2493
   */
  if (ctx.refreshOptions() !== undefined) return Promise.resolve(session);
  return ctx.open().then(() => session, () => session);
}
