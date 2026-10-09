import { RpcError } from '../rpc.js';
import { computerId } from '../computers.js';
import { deleteNested } from '../nested.js';
import { localPath, uriOf } from '../fileuri.js';
import { idOf } from '../catalog.js';
import { join } from 'node:path';
import { worktreeFor, worktreesOf } from '../repo/worktrees.js';
import { ROOT, chatUriFor, named } from './channels.js';
import { BANG, HOSTS_OWN } from './common.js';
import { autoApproved, requireTrust } from './trust.js';
import type { Bag } from '../types/common.js';
import type { Session, MessageAttachment, MessageFrom } from '../types/session.js';
import type { Owner } from '../types/usage.js';
import type { Principal } from '../types/users.js';
import type { Connection } from '../types/host.js';
import type { Agent } from '../types/agent.js';
import type { Held } from './state.js';
import type { HostContext } from './context.js';

/** A move a session's agent asked for, waiting for its turn to end. */
export interface Move {
  /** The chat whose turn asked, which is the one the move belongs to. */
  chat: string;
  /** The folder the session is asked to move into. */
  directory: string;
  /** Whether a worktree is made from it rather than working in it directly. */
  isolation: boolean;
  /**
   * The window whose turn asked for it, which is the one to ask about trust.
   *
   * Absent where no window sent that turn - an automation's session, a host
   * tool's - and a folder no window vouched for is one the session stays out
   * of, which is the same answer and a refusal rather than an exception.
   */
  sender?: Connection;
}

/**
 * About to make a worktree, before anything exists.
 *
 * Handed the repository it is cut from and the path it will be made at, which
 * is the pair VS Code asks its window about in the same place - `onWillCreate`,
 * `sessionWorkspaceConversionService.ts:408-413` - and for the same reason: the
 * path is only known once the branch and the root are, and the question has to
 * be answered before anything is created.
 */
export type BeforeWorktree = (repository: string, path: string) => Promise<void>;

/**
 * What happens to a session between being opened and being gone.
 *
 * The restart a move and a new directory both go through, the disposal that
 * ends one, and the turn a message becomes - the checks it answers to, the
 * `!` command it may turn out to be, and the model and origin it carries.
 */
export interface Lifecycle {
  /** A session gone, with everything it held, and the backend's own copy of it. */
  removeSession(uri: string, acting?: Principal | Owner): Promise<void>;
  /** Start a session again, in the directory its config now names. */
  restart(
    uri: string,
    credentials: Record<string, string>,
    keeping?: { additional?: string[]; directory?: string },
    sender?: Connection,
    before?: BeforeWorktree,
  ): Promise<void>;
  /** The move `set_workspace` asked for, once the turn that asked is over. */
  moveSession(uri: string, move: Move): Promise<void>;
  /** Start one chat again, in the directories it now has. */
  restartChat(uri: string, chatUri: string, credentials: Record<string, string>, sender?: Connection): void;
  /** What the backend is given: everything except what this host answered. */
  backendsOwn(config: Record<string, unknown>): Record<string, unknown>;
  /** Where a session actually runs, once isolation has been answered. */
  isolated(
    uri: string,
    config: Record<string, unknown>,
    where: string | undefined,
    before?: BeforeWorktree,
  ): Promise<string | undefined>;
  /** A message's turn, whichever way it arrived. */
  beginOrRun(
    session: Session,
    provider: string,
    turnId: string,
    text: string,
    model: ReturnType<Lifecycle['modelIn']>,
    from: MessageFrom | undefined,
    sender?: Connection,
    queuedAs?: string,
    attachments?: MessageAttachment[],
  ): string | undefined | Promise<string | undefined>;
  /** A turn begun, or a turn refused, from what `beginOrRun` answered. */
  beginTurn(
    begun: string | undefined | Promise<string | undefined>,
    refused: (why: string) => void,
  ): void;
  /** The model a message names, or nothing when it names none. */
  modelIn(value: unknown): { id: string; config?: Record<string, string | number | boolean | null> } | undefined;
  /** Who a message came from, read off the message itself, and what it picked. */
  messageFrom(message: Record<string, unknown>): MessageFrom | undefined;
  /** What a client attached to its message, read off the message itself. */
  messageAttachments(message: Record<string, unknown>): MessageAttachment[] | undefined;
  /** Start a session. */
  openSession(
    uri: string,
    provider: string,
    config: Record<string, unknown>,
    where: string | undefined,
    origin?: { kind: 'automation'; automation: string; run: string },
    credentials?: Record<string, string>,
    additional?: string[],
    title?: string,
    by?: { owner?: Owner; principal?: Principal; sender?: Connection },
  ): void;
}

export function createLifecycle(ctx: HostContext): Lifecycle {
  const {
    options, sessions, byChat, subagents, owners, kept, decided, offered, worktrees, origins,
    drafts, madeFrom, resumedSessions, githubFacts, principals, presence, marks, lives, beside,
    dispatch, broadcast, flushDeltas, log, fire, sessionEvents, leadOf,
    dirOf, changesetOf, stopUnwatched, captureBaseline,
    sessionMachines, enteredIn, inMachine, takeOut, placedIn, followOf,
    isolating, charged, senders, sentBy, checked, principalFor, machineFor, ownerFor,
    contributedDefaults, rootConfig,
    spawn, keepTitle, keepProvider,
    sessionAdded, forgetSent, activeSessionsMoved,
  } = ctx;

  /**
   * Everything a session this daemon is holding took with it.
   *
   * The part of a delete that is the host's own: the chats closed, the
   * terminals they claimed killed, the worktree removed if clean, the run that
   * started it unlinked, and everything this host kept *about* the session
   * let go. What the backend keeps is the backend's, and `removeSession` asks
   * for it once this is done.
   */
  const teardown = (held: Held, uri: string): void => {
    for (const [chatUri, chat] of held.chats) {
      chat.close();
      byChat.delete(chatUri);
      drafts.delete(chatUri);
      madeFrom.delete(chatUri);
      ctx.links.forgetChat(chatUri);
      // And what the session stream was holding for it: a turn nothing will
      // end and calls nothing will finish are not measurements of anything.
      ctx.sessionEvents.forget(chatUri);
    }
    /*
     * And the worker chats the session opened.
     *
     * Not `held.chats`, because a worker has no `Session`; but they are chats
     * of this session all the same, and one left behind is a channel in the
     * catalogue that nothing will ever answer on again.
     */
    resumedSessions.delete(uri);
    for (const [chatUri, one] of [...subagents]) {
      if (one.session !== uri) continue;
      subagents.delete(chatUri);
      ctx.describedSub.delete(chatUri);
      ctx.endedWorkers.delete(chatUri);
      ctx.links.forgetChat(chatUri);
      ctx.links.forget(one.parentChat, one.toolCallId);
      ctx.sessionEvents.forget(chatUri);
      dispatch(uri, { type: 'session/chatRemoved', chat: chatUri });
    }
    /*
     * And the shells the session was holding.
     *
     * A terminal claimed by a session outlives nothing: the chat it
     * belongs to is gone, so the transcript that pointed at it is gone
     * too, and what is left is a channel in the root catalogue that
     * nobody can reach. `!` commands are the ordinary way these
     * accumulate - one terminal each, kept so the finished tool call
     * points somewhere real.
     */
    for (const [terminalUri, terminal] of [...ctx.terminals]) {
      const claim = terminal.claim();
      if (claim.kind !== 'session' || claim.session !== uri) continue;
      terminal.close();
      ctx.terminals.delete(terminalUri);
    }
    dispatch(ROOT, { type: 'root/terminalsChanged', terminals: ctx.terminalInfo() });
    /*
     * And the worktree, unless somebody's work is still in it.
     *
     * The decision this feature turns on. A worktree with uncommitted
     * changes is the one thing here a daemon cannot judge the value of:
     * it may be an experiment nobody wanted, or the only copy of an
     * afternoon. So a clean one goes and a dirty one stays exactly where
     * it is, on the branch it was made on, findable with `git worktree
     * list` - and the path is logged, because the session it belonged to
     * is about to stop being a place to say it.
     *
     * Not refusing the dispose instead: a session somebody cannot close
     * because of a file they forgot about is a session they close by
     * killing the daemon.
     */
    const tree = worktrees.get(uri);
    if (tree) {
      worktrees.delete(uri);
      const port = options.worktrees;
      void (async () => {
        if (await port?.dirty(tree.path).catch(() => true) !== false) {
          log(`kept ${tree.path}: it has changes nobody committed`);
          return;
        }
        await port?.remove(tree.repository, tree.path, tree.branch)
          .then(() => { log(`removed ${tree.path}`); })
          .catch((error: unknown) => {
            log(`kept ${tree.path}: ${error instanceof Error ? error.message : String(error)}`);
          });
      })();
    }
    /*
     * The directory's git watch, closed when this was the last watched session
     * in it: a session that is gone keeps nothing there watched.
     */
    const gone = dirOf(uri);
    sessions.delete(uri);
    // And the tools server this session opened, which stops answering with it.
    ctx.toolsServersGone(uri);
    if (gone !== undefined) stopUnwatched(gone);
    const left = enteredIn.get(uri);
    /*
     * And the session's own files, taken back out of that machine.
     *
     * What a session in a machine was handed, one message at a time, is this
     * host's copy made for that one session - decision
     * `a-session-in-a-machine-gets-each-attachment-copied-into-it`. A machine
     * another session is still in keeps nothing of the one that has gone, and
     * a machine that has gone with the session is nothing to take anything out
     * of. Asked before the leave below, because a machine whose last session
     * this is may start its own countdown the moment it hears that.
     */
    takeOut(left, uri);
    /*
     * And the machine it was running in, told that this session has left.
     *
     * A disposable machine's last session leaving is what starts the delay
     * before it is removed, so this and `enter` are the only two moments its
     * count moves. The machine is the one it entered rather than the one the
     * config names now: a session that moved away from its machine and came
     * back would otherwise leave a machine it has long since left.
     *
     * A disposal of a session nobody resumed is not here: disposing is a thing
     * a session running in this process does, and `spawn` enters the machine
     * every one of them starts in. The session a daemon adopted a machine for
     * and never ran is let go by the listing that stops finding it.
     */
    inMachine(left, uri, false);
    enteredIn.delete(uri);
    sessionMachines.delete(uri);
    // Gone from the map first, so a handler asking about it is told the truth.
    void fire({ type: 'session_end', session: uri, reason: 'disposed' });
    /*
     * And the session this one was started from, told that its child finished.
     *
     * Before the stored record is forgotten below, because that record is
     * where the link is - and read from the store rather than remembered here,
     * so a child that ends after a restart reaches the session that started
     * it just the same.
     */
    sessionEvents.ended(uri);
    /*
     * And the run that started it, which is now holding a URI that
     * opens onto nothing.
     *
     * The store answers whether the set actually moved and says so
     * through `onChanged`, which is where the action comes from - so a
     * store that keeps its runs immutable simply changes nothing here.
     */
    const from = origins.get(uri);
    if (from !== undefined) options.automations?.unlink?.(from.run, uri);
    /*
     * And the run itself, when this was the last session of it still busy. A
     * run already finished by its turn is left alone by the store, so a
     * disposal after a completed turn changes nothing.
     */
    if (from !== undefined) ctx.settleRun(uri, { status: 'cancelled' });
    origins.delete(uri);
    /*
     * And the rules, which were measuring a session that is no longer here: a
     * turn this process will never see end, and a wake held behind a chat in a
     * session that is gone are both things nothing may act on. What such a wake
     * starts makes itself another session, the same as a pinned run whose chat
     * was never there.
     */
    ctx.gone(uri);
    presence.delete(idOf(uri));
    // And what was kept *about* it. All of these are keyed by a session
    // that no longer exists, so anything left here is held for nobody -
    // a daemon that runs for weeks would accumulate one of each per
    // session anybody ever opened, and a store that writes them down
    // would keep them for ever.
    marks.delete(idOf(uri));
    decided.delete(uri);
    charged.delete(uri);
    kept.forget(idOf(uri));
    offered.delete(uri);
    owners.delete(uri);
    lives.delete(uri);
    for (const channel of [...ctx.shown.keys()]) {
      if (changesetOf(channel, uri)) ctx.shown.delete(channel);
    }
    activeSessionsMoved();
  };

  /*
   * The providers this host has already said cannot delete.
   *
   * Once each, because the second session disposed under an agent that cannot
   * delete says nothing new, and a log that repeats itself on every disposal
   * is a log nobody reads.
   */
  const cannotDelete = new Set<string>();

  /**
   * The backend's own copy of a session, gone.
   *
   * Asked of the agent that owns the row, after whatever this host was holding
   * has been torn down - a transcript written again by a backend still running
   * is a session that comes back on the next listing, which is the gap this
   * closes.
   *
   * A store that says the session is not there counts as deleted: a session
   * deleted twice is deleted, and a refusal over a row that is already gone
   * would be the host failing a request it had in fact carried out.
   *
   * Anything else is returned rather than thrown, so the caller can finish what
   * the host owes the client - the broadcast, and the answer that the session
   * is gone - before the failure is reported. A delete that failed silently is
   * the bug this exists for, so it is never swallowed: the error goes back to
   * the request that asked, and the row may be listed again.
   */
  const deleted = async (
    uri: string,
    agent: Agent,
    directory: string | undefined,
  ): Promise<unknown> => {
    if (agent.delete === undefined) {
      if (!cannotDelete.has(agent.provider)) {
        cannotDelete.add(agent.provider);
        log(`${agent.provider} keeps its own copy of a deleted session, so it may be listed again`);
      }
      return undefined;
    }
    try {
      await agent.delete(idOf(uri), directory);
      return undefined;
    }
    catch (error) {
      log(`could not delete ${uri} from ${agent.provider}: ${error instanceof Error ? error.message : String(error)}`);
      return error;
    }
  };

  /**
   * A nested session's copy inside its machine, gone.
   *
   * Only for a session this host is not running: a running one is disposed
   * inside by its own close, which reaches the machine on the way down. What is
   * left is a row this host lists from its record while the machine still holds
   * the session - a stop whose dispose never landed, a daemon that was killed,
   * a machine that came back - and the profile of that machine is what decides
   * what happens to it: `inside` starts a host in the machine for the one
   * question, `record` leaves the transcript where it is - decision
   * `a-nested-host-is-configured-by-the-machine-profile-only`.
   *
   * The plugin the session's agent was registered by is what the host inside is
   * started with, so a record whose plugin this daemon does not have ends with a
   * line rather than with a host that serves nobody.
   */
  const deletedInside = async (uri: string): Promise<void> => {
    const record = kept.nested?.(idOf(uri));
    if (record === undefined) return;
    const computers = options.computers;
    const said = await computers?.nestedDelete?.(record.machine).catch(() => undefined);
    if (said === 'record') return;
    const plugin = options.agentPlugins?.[record.provider];
    if (plugin === undefined) {
      log(`${record.inner} is inside computer://${record.machine}, and this host does not know which plugin serves ${record.provider}, so nothing was deleted there`);
      return;
    }
    await deleteNested({
      id: record.machine,
      plugins: [plugin],
      sessionId: record.inner,
      ...(computers === undefined ? {} : { computers }),
      log,
    });
  };

  /**
   * Whether this caller is allowed to delete this session.
   *
   * `session:write` says a caller may change sessions; it does not say whose.
   * A delete cannot be undone and the backend's own copy goes with it, so
   * without this a member of a shared host could end somebody else's
   * conversation - which is a different thing from writing in it.
   *
   * Two callers are let through: the session's owner, and anybody holding
   * `session:*`, which is the wildcard an administrator's role resolves to.
   * The owner's own reference is `user:<id>`, the same spelling `ownerFor`
   * writes, so a person signed in on two connections is one owner and either
   * connection may delete.
   *
   * No principal is no decision: a host with no users directory has nobody to
   * name, and so has every connection to it - including the root one. Nothing
   * is refused that was not refused before, which is what makes this safe to
   * add to a host that never had people in it.
   *
   * An owner without a principal is a person this process has not met since it
   * started, so their roles are unknown: they may delete their own sessions and
   * nobody else's. The host's own `root:` owner is not a person and is refused
   * nothing.
   */
  const mayDispose = (acting: Principal | Owner | undefined, uri: string): void => {
    if (acting === undefined) return;
    if (typeof acting === 'string') {
      if (acting.startsWith('root:') || kept.owner(idOf(uri)) === acting) return;
      log(`${acting} tried to delete ${uri}, which is not theirs`);
      throw new RpcError(-32009, "Only the session's owner can delete it.");
    }
    if (kept.owner(idOf(uri)) === `user:${acting.id}`) return;
    if (acting.can('session:*')) return;
    log(`${acting.id} tried to delete ${uri}, which is not theirs`);
    throw new RpcError(-32009, "Only the session's owner can delete it.");
  };

  /**
   * A session gone, from every client and from the backend's own catalogue.
   *
   * What `disposeSession` does, and what the `delete_session` tool does from
   * inside another session. A session the daemon is running is torn down first
   * and its backend asked for its own copy afterwards; a row the daemon only
   * lists has nothing to tear down, and goes straight to the same delete.
   *
   * Neither half is the other half's job, which is the whole of it: a host
   * that forgets a session and leaves the store alone tells every client the
   * thing is gone and offers it again in the next list.
   *
   * `acting` is the person asking, and nobody for a connection that is not
   * somebody - see `mayDispose`. The check is first, before the teardown,
   * because a refusal must leave the session exactly as it was: a half-disposed
   * session would be worse than either answer.
   *
   * A name in neither map is not a session this host has ever heard of, and
   * says so rather than deleting nothing successfully.
   */
  const removeSession = async (uri: string, acting?: Principal | Owner): Promise<void> => {
    mayDispose(acting, uri);
    const held = sessions.get(uri);
    const owner = owners.get(uri);
    if (!held && !owner)
      throw new RpcError(-32001, `No agent for session ${uri}`);
    const agent = held?.agent ?? (owner as Agent);
    /*
     * The turn's last words before the session that said them goes.
     *
     * A chat closing does not end a stream: what is held would be sent after
     * the teardown below, against a chat every client has already been told is
     * gone.
     */
    flushDeltas();
    /*
     * Read before either is let go of, and before the row's directory goes
     * with it: `dirOf` answers out of `sessions` or `wheres`, and this is the
     * only moment at which both still say where the session ran.
     */
    const directory = dirOf(uri);
    if (held !== undefined) teardown(held, uri);
    else await deletedInside(uri);
    const failure = await deleted(uri, agent, directory);
    if (held === undefined) {
      // Nothing was held, so nothing was torn down and what this host kept
      // about the row is still here: the backend has it, and the host does
      // not need to.
      kept.forget(idOf(uri));
      owners.delete(uri);
    }
    // Every other client is told, because the session was theirs too.
    // `session`, which is the name the protocol gives it. Under
    // `resource` a client reads `undefined` and takes nothing out, so a
    // disposed session stayed in every catalogue until something else
    // made that client re-read the list.
    /*
     * Out of the rows this host is holding as well as out of the backend's
     * store. A client told a session is gone and then handed it by the next
     * `listSessions` is the same half answer, one layer down - and the row is
     * dropped before the broadcast, so the pass behind the answer that
     * followed it cannot bring the row back.
     */
    ctx.drop(uri);
    forgetSent(uri);
    broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: uri });
    log(`disposed ${uri}`);
    if (failure !== undefined) throw failure;
  };

  const restart = async (
    uri: string,
    credentials: Record<string, string>,
    keeping?: { additional?: string[]; directory?: string },
    sender?: Connection,
    before?: BeforeWorktree,
  ): Promise<void> => {
    const held = sessions.get(uri);
    if (!held) return;
    const mine = decided.get(uri) ?? {};
    // The repository rather than the worktree: the choice is made against the
    // directory somebody asked for, and a worktree is only where a previous
    // answer put it. Or the directory a move asked for, which is neither.
    const from = keeping?.directory ?? worktrees.get(uri)?.repository ?? held.workingDirectory;
    const was = worktrees.get(uri);
    if (was) {
      worktrees.delete(uri);
      // Removed without asking whether it is dirty, unlike a disposed session:
      // nothing has ever run in this one, so there is nothing in it to keep.
      await options.worktrees?.remove(was.repository, was.path, was.branch)
        .then(() => { log(`removed ${was.path}`); })
        .catch((error: unknown) => {
          log(`kept ${was.path}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    const to = await isolated(uri, mine, from, before);
    const wasAt = held.workingDirectory;
    /*
     * Their names stay the session's while it starts again, and so does the
     * conversation: the backend is stopped without disposing the session it
     * holds, because the one starting behind it resumes that session rather
     * than making a new one.
     *
     * `stopping` is waited on before the new backend is started, so the two
     * are never on this transcript at once - a host inside a machine takes a
     * while to go, and until it has, it is still writing what it was doing.
     */
    const stopping: Promise<void>[] = [];
    for (const [chatUri, chat] of held.chats) {
      stopping.push(Promise.resolve(chat.close(false)));
      byChat.drop(chatUri);
    }
    /*
     * The conversation, when this is a restart rather than a re-creation.
     *
     * Adding a directory to a session somebody is in the middle of using is a
     * new CLI with a wider set - the SDK takes its directories at startup and
     * exposes no way to add one after - so the backend is started again and
     * *resumed*, which is what makes it the same conversation rather than a
     * new one in the same place.
     */
    const lead = leadOf(held);
    const talking = keeping !== undefined && lead !== undefined && lead.agentId() !== undefined
      ? { resume: lead.agentId() as string, seed: lead.allTurns() }
      : undefined;
    /*
     * The old directory's watch, kept while the session comes back to the same
     * place: the clients watching it there still watch it.
     */
    const previous = dirOf(uri);
    sessions.delete(uri);
    if (previous !== undefined && previous !== to) stopUnwatched(previous);
    try {
      /*
       * A machine named now, when the config names a source.
       *
       * A client that opens a session before deciding can pick a disposable
       * profile before the first turn, and that arrives as this restart - so
       * the source is made into a machine here too, rather than handed to a
       * backend that has no way to enter it. A session that already has its
       * machine is left exactly as it was.
       */
      await placedIn(uri, held.agent.provider, held.config, to, kept.owner(idOf(uri)));
      /*
       * And the machine it is leaving, when this restart puts it somewhere
       * else.
       *
       * A session that picked a disposable profile and then chose this host, or
       * another machine, is not in that machine any more - and a disposable one
       * waits out its delay for exactly this. The source it named goes too:
       * picking the same profile again has to make a new machine rather than
       * hand back the one it left, which is the machine a client is naming
       * now that no session is in.
       */
      const left = enteredIn.get(uri);
      if (left !== undefined && left !== computerId(held.config.computer)) {
        inMachine(left, uri, false);
        enteredIn.delete(uri);
        sessionMachines.delete(uri);
        /*
         * And the record that pointed at the machine, which is what made the
         * session nested and is now the wrong answer to every question asked
         * of it: the machine is not where it runs, so nothing runs there, and
         * a daemon that restarts reads the record and shows an empty
         * conversation for a session this host has the turns of. Left behind,
         * it also keeps the row unprunable, since a record is what says a
         * machine still holds the session.
         */
        kept.setNested?.(idOf(uri), undefined);
      }
      // The last thing before the new backend: the old one's process is gone.
      await Promise.all(stopping);
      spawn(
        held.agent,
        uri,
        held.defaultChat,
        backendsOwn(held.config),
        talking,
        to,
        credentials,
        keeping?.additional ?? held.additional,
        sender,
      );
    }
    catch (error) {
      /*
       * The machine it was in, which nothing is in any more: the old backend
       * is gone and the new one would not start, so this session is over
       * whatever the caller does with the refusal.
       */
      const left = enteredIn.get(uri);
      inMachine(left, uri, false);
      enteredIn.delete(uri);
      sessionMachines.delete(uri);
      /*
       * A session that existed and now does not.
       *
       * `createSession` fails inside its own request and there is nothing to
       * announce, but this is the other case: clients are subscribed, the old
       * backend is gone, and the new one would not start. `creationFailed` is
       * the action for exactly that, and saying nothing would leave every one
       * of them watching a channel that will never speak again.
       */
      dispatch(uri, {
        type: 'session/creationFailed',
        error: {
          errorType: 'sessionStartFailed',
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
    log(`restarted ${uri}${to === undefined ? '' : ` in ${to}`}`);
    /*
     * The machine it is in was told by `spawn`, which the restart above reached.
     * A restart of a session already inside one adds the same session again,
     * which a set of sessions does not count twice and which cancels nothing
     * that was running: a pre-turn restart is not a second user.
     */
    if (wasAt === to) return;
    /*
     * Replaced, not removed and re-added.
     *
     * Index 0 is the process root, and the protocol has one action for a root
     * that moves: `workingDirectoryReplaced`. Saying it as a removal followed
     * by an addition would be a client briefly holding a session with no
     * directory at all.
     */
    if (to !== undefined) dispatch(uri, { type: 'session/workingDirectoryReplaced', directory: uriOf(to) });
  };

  /**
   * The move `set_workspace` asked for, once the turn that asked is over.
   *
   * The session is restarted where it was asked to go, resumed so it is the
   * same conversation, with a worktree made from the directory when isolation
   * was asked for. Then a continuation turn tells the agent where it now is
   * and to carry on, marked the way the reference host marks its own: the
   * request hidden so the window draws the answer and not the prompt, the
   * label a person reads wherever the turn is listed, and the continuation
   * key that keeps the turn owning the file changes made in it.
   */
  const moveSession = async (uri: string, move: Move): Promise<void> => {
    const held = sessions.get(uri);
    if (!held) return;
    /*
     * The window that asked is asked about the folder, before anything is
     * moved or made.
     *
     * The same question a client adding a folder is asked, and answered from
     * the same value: a folder the asking window has already pushed as trusted
     * is entered without a round trip, and one it has not is entered only on
     * its yes - decision
     * `a-folder-is-untrusted-until-a-client-says-otherwise`.
     */
    const effective = { ...held.agent.defaults(), ...contributedDefaults(), ...held.config };
    const auto = autoApproved(effective, rootConfig);
    await requireTrust({ folder: move.directory, sender: move.sender, autoApproved: auto });
    decided.set(uri, { ...decided.get(uri), isolation: move.isolation ? 'worktree' : 'folder' });
    offered.set(uri, (await isolating(move.directory, move.isolation ? 'worktree' : 'folder')).schema);
    await restart(uri, {}, { additional: [], directory: move.directory }, move.sender, async (repository) => {
      /*
       * The repository the worktree is cut from, when it is not the folder the
       * move asked for - a subdirectory of a repository the window may never
       * have opened.
       *
       * The worktree itself is not asked about: the host makes it, and one the
       * host made is trusted exactly when its repository is - decision
       * `a-worktree-inherits-its-repositorys-trust`. The repository the window
       * vouches for here is remembered on its connection, so the backend
       * started in the worktree is told the same thing.
       */
      if (repository !== move.directory) {
        await requireTrust({ folder: repository, sender: move.sender, autoApproved: auto });
      }
    });
    const lead = byChat.get(chatUriFor(uri));
    const now = sessions.get(uri)?.workingDirectory ?? move.directory;
    lead?.chat.begin(
      crypto.randomUUID(),
      `The workspace is now ${now}${move.isolation ? ', an isolated worktree' : ''}. Continue the task you were working on there.`,
      undefined,
      {
        origin: { kind: 'systemNotification' },
        _meta: {
          'vscode.chat.requestHiddenFromTranscript': true,
          'vscode.chat.systemInitiatedLabel': 'Continue in Requested Workspace',
          'vscode.chat.workspaceContinuation': true,
        },
      },
    );
  };

  /**
   * Start one chat again, in the directories it now has.
   *
   * The session's own `restart` rebuilds every chat; this rebuilds one, and
   * for the same reason: the SDK takes its directories when the CLI starts
   * and offers no way to add one after. Resumed, so it is the same
   * conversation - a chat that lost its history because a directory was added
   * to it would be a worse answer than refusing.
   */
  const restartChat = (uri: string, chatUri: string, credentials: Record<string, string>, sender?: Connection): void => {
    const held = sessions.get(uri);
    const chat = held?.chats.get(chatUri);
    if (held === undefined || chat === undefined) return;
    const talking = chat.agentId() !== undefined
      ? { resume: chat.agentId() as string, seed: chat.allTurns() }
      : undefined;
    /*
     * Started again rather than removed, which is what the chat coming back
     * resumed needs: told a removal, a backend running nested in a machine
     * disposes the session inside, and the chat that starts behind it opens
     * on a transcript that is gone.
     */
    chat.close(false);
    held.chats.delete(chatUri);
    byChat.drop(chatUri);
    spawn(
      held.agent,
      uri,
      chatUri,
      backendsOwn(held.config),
      talking,
      held.workingDirectory,
      credentials,
      beside.get(chatUri) ?? held.additional,
      sender,
    );
    log(`restarted ${chatUri}`);
  };

  /** What the backend is given: everything except what this host answered. */
  const backendsOwn = (config: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(config).filter(([key]) => !HOSTS_OWN.includes(key)));

  /**
   * Where a session actually runs, once isolation has been answered.
   *
   * Answered here rather than in the backend because the tree is the host's:
   * a backend is handed a directory and told to work in it, and which
   * directory that is - the folder, or a worktree made for this session - is
   * exactly the decision the client made with `isolation`.
   */
  const isolated = async (
    uri: string,
    config: Record<string, unknown>,
    where: string | undefined,
    before?: BeforeWorktree,
  ): Promise<string | undefined> => {
    const port = options.worktrees;
    if (!port || config.isolation !== 'worktree' || where === undefined) return where;
    const repository = await port.repository(where);
    if (repository === undefined) {
      throw new RpcError(-32602, `${where} is not a git repository, so it has no worktrees`);
    }
    const said = (key: string): string => (typeof config[key] === 'string' ? config[key] : '');
    /*
     * The branch this session runs on, and whether there is a new one at all.
     *
     * `agents/` is the built-in prefix the reference uses too, and a client's
     * own goes in front of it: somebody whose `git.branchPrefix` is `softov/`
     * gets `softov/agents/1a2b3c4d`, which is what their other tools already
     * sort and filter by. `worktreeCreateNewBranch: 'false'` means there is no
     * new branch - the session continues the one that was chosen.
     */
    const making = said('worktreeCreateNewBranch') !== 'false';
    const branch = making
      ? `${said('worktreeBranchPrefix')}agents/${idOf(uri).slice(0, 8)}`
      : undefined;
    const base = typeof config.branch === 'string' ? config.branch : 'HEAD';
    const path = join(worktreesOf(repository, options.worktreesRoot), worktreeFor(branch ?? base));
    // Read as either spelling: the array the schema declares, or a
    // comma-separated string. A config value is `unknown` on the wire - the
    // protocol declares the bag `Record<string, unknown>` and `permissions` is
    // an object - so a key this host declared is narrowed where it is used
    // rather than assumed everywhere.
    const patterns = config.worktreeIncludeFiles;
    const include = (Array.isArray(patterns)
      ? patterns.filter((one): one is string => typeof one === 'string')
      : typeof patterns === 'string' ? patterns.split(',') : [])
      .map((one) => one.trim()).filter((one) => one !== '');
    /*
     * The folders to link, read as an array only.
     *
     * Narrowed the same way, since a value from the wire is `unknown`, and
     * handed on as a list of its own.
     */
    const wanted = config.worktreeSymlinkFolders;
    const symlink = (Array.isArray(wanted)
      ? wanted.filter((one): one is string => typeof one === 'string')
      : []).map((one) => one.trim()).filter((one) => one !== '');
    // Asked after the path is known and before anything exists at it, which is
    // where VS Code asks too: the window is shown the worktree it is about to
    // be given, and a folder that does not exist yet is vouched for by the
    // repository it is cut from rather than by itself.
    await before?.(repository, path);
    await port.create({
      repository,
      base,
      ...(branch !== undefined ? { branch } : {}),
      ...(said('worktreeBranchTrack') === 'true' ? { track: true } : {}),
      path,
      ...(include.length > 0 ? { include } : {}),
      ...(symlink.length > 0 ? { symlink } : {}),
    });
    // The branch is remembered rather than derived from the directory later:
    // a prefix a client asked for changes the name, and guessing it wrong at
    // removal time either deletes nothing or names somebody else's.
    worktrees.set(uri, { repository, path, base, ...(branch !== undefined ? { branch } : {}) });
    log(`made ${path} on ${branch ?? base} for ${uri}`);
    return path;
  };

  /**
   * A message's turn, whichever way it arrived.
   *
   * `!ls` is a command, and everything else is a question. Trimmed, and empty
   * means it was neither: a lone `!` is somebody typing an exclamation mark,
   * and it goes to the agent like any other text. A turn reaches a backend by
   * more than one road - a live session, one resumed from disk for it, a
   * chat's first message, a message queued behind a running turn - and each
   * takes this one, so none of them hands `!ping` to a model.
   *
   * `queuedAs` is the queued message's id when the text came through
   * `chat/pendingMessageSet`: a question is queued under it, and a command
   * is handed to `ran` under it, so it waits its turn as a command.
   *
   * Answers why the command cannot run when the backend has no `Session.ran`,
   * for the caller to refuse with; handing the text to the model instead is
   * the one thing the prefix promises not to do.
   *
   * `sender` is who asked, held against this turn for as long as it runs.
   *
   * A promise only for a turn that had to be asked about, or one in a machine:
   * everything else is answered here and now, which is what keeps the actions of
   * a turn in the order they were already written in.
   */
  const beginOrRun = (
    session: Session,
    provider: string,
    turnId: string,
    text: string,
    model: ReturnType<typeof modelIn>,
    from: MessageFrom | undefined,
    sender?: Connection,
    queuedAs?: string,
    attachments?: MessageAttachment[],
  ): string | undefined | Promise<string | undefined> => {
    /*
     * No new turn while an embedder is on its way out.
     *
     * Every road a turn reaches a backend by comes through here, which is why
     * the hold is asked here rather than at each of them. Read off the context
     * rather than destructured above, because a hold taken after this area was
     * built is the one that counts - and a host that stops taking turns does
     * stop, rather than only saying so.
     */
    if (ctx.refusing !== undefined) return ctx.refusing;
    /*
     * A turn with nowhere to charge.
     *
     * Asked here rather than when the session was created, because the name
     * may have arrived since - a client picks a scope, sends it in the config
     * and then says something - and refused here rather than at the picker,
     * because a picker is a suggestion and this is the thing being asked for.
     */
    const uncharged = charged.get(session.uri)?.refusal;
    if (uncharged !== undefined) return uncharged;
    /*
     * Whose the work is, from the window that asked for it: the owner a session
     * is charged to is a name, and the connection it arrived on is the window
     * that can be asked something back. One conversion, here, because every
     * call site had a connection in hand and was doing it itself.
     */
    const who = sender === undefined ? undefined : ownerFor(sender);
    const run = (): string | undefined => {
      /*
       * Who sent it, against the id this turn will be known by: the turn id when
       * it starts now, and the queued message's id when it waits its turn. A
       * queued message is one turn that has not been given an id yet, and the
       * backend says which turn it became when it runs - so the sender is moved
       * across there rather than looked for here under an id it will never
       * carry again.
       */
      if (who !== undefined) senders.set(queuedAs ?? turnId, who);
      // And the window itself, under the same id, for whatever has to ask it
      // something later - the move an agent asks for in this turn most of all.
      if (sender !== undefined) sentBy.set(queuedAs ?? turnId, sender);
      const command = text.startsWith(BANG) ? text.slice(BANG.length).trim() : '';
      if (command === '' || !options.terminals) {
        if (queuedAs === undefined) session.begin(turnId, text, model, from, attachments);
        else session.queue(queuedAs, text, model, from, attachments);
        return undefined;
      }
      if (!session.ran) return `${provider} cannot run a command in a turn; use a terminal instead`;
      const first = session.workingDirectories()[0];
      const where = first === undefined ? options.path : localPath(first);
      session.ran(turnId, command, (toolCallId) => ctx.commanded(command, where, {
        kind: 'session',
        session: session.uri,
        chat: session.chatUri,
        turnId,
        toolCallId,
      }), queuedAs);
      return undefined;
    };
    /*
     * The machine the session is in, put where the host's branch is.
     *
     * A machine commits in a git directory of its own, so a commit made on the
     * host since it last looked is not in the history the agent's next turn
     * reads - decision
     * `a-machine-commits-in-its-own-repository-and-the-host-fetches-it`. The
     * port's call decides the rest, and a machine holding work the host has not
     * fetched is left as it is, and says so in the log.
     *
     * A queued message is not handed it: the turn it becomes runs behind the one
     * that is running, in a machine an agent is working in, and a hand-over
     * writes the machine's own ref and index - not something to do to a machine
     * between two commands of a turn. The fetch at the running turn's end is
     * what puts that machine where the host is.
     *
     * A session in no machine asks nothing and is begun here and now, which is
     * every turn of a session on this host.
     */
    const turn = (): string | undefined | Promise<string | undefined> =>
      (queuedAs !== undefined || enteredIn.get(session.uri) === undefined ? run() : followOf(session.uri).then(run));
    /*
     * The turn's own check, beside the one above.
     *
     * The session was checked when it was created, for its harness and the
     * machine it asked for. A turn is checked again because the model is new to
     * it: the session was created before anybody said which model would run.
     *
     * Who sent it is whoever asked, and the session's owner is the fallback -
     * a turn this host started itself is nobody's to refuse. A message that
     * named no model leaves the model out of the request rather than resolving
     * one, because the host never learns which model a harness picked for
     * itself and a check that guessed would be checking nothing.
     *
     * The three ways there is nothing to ask are asked here rather than left to
     * `checked`, so a turn they cover is begun in the same tick it arrived in.
     */
    const principal = principalFor(who ?? kept.owner(idOf(session.uri)));
    const store = options.policies;
    if (options.policiesCheck !== true || store === undefined || principal === undefined) return turn();
    const held = sessions.get(session.uri);
    return checked(principal, charged.get(session.uri)?.scope, [{
      kind: 'agent',
      asked: {
        agent: provider,
        computer: machineFor(held?.config ?? {}),
        ...(model === undefined ? {} : { model: model.id }),
      },
    }]).then((why) => why === undefined ? turn() : why);
  };

  /**
   * A turn begun, or a turn refused, from what `beginOrRun` answered.
   *
   * For the two call sites that stand in a `switch` and cannot wait. An answer
   * that came already is taken at once; one that is still to come is taken when
   * it comes, and a turn nothing refused is begun then as well.
   *
   * A promise that rejects is a refusal too, in the thrown error's own words: an
   * answer later than the tick it was asked in comes from a backend, a machine
   * or a policy check, and a backend that throws while the turn is begun - a CLI
   * that is gone, a machine that will not take a command - is a turn the client
   * asked for and is not getting. Left unhandled it is a rejection nobody reads
   * and a client waiting for an answer that never comes.
   */
  const beginTurn = (
    begun: string | undefined | Promise<string | undefined>,
    refused: (why: string) => void,
  ): void => {
    if (typeof begun === 'string') refused(begun);
    else if (begun !== undefined) {
      void begun.then(
        (why) => { if (why !== undefined) refused(why); },
        (error: unknown) => { refused(error instanceof Error ? error.message : String(error)); },
      );
    }
  };

  /**
   * The model a message names, or nothing when it names none.
   *
   * `TurnMessage.model` is a `ModelSelection` - `{ id, config }` - and reading
   * it as a string is how a client's choice was accepted and dropped. The
   * `config` is the form that model advertised, and its values are primitives
   * because that is what the protocol carries; anything else reached this host
   * by not being what it says it is, and is left out.
   */
  const modelIn = (value: unknown): { id: string; config?: Record<string, string | number | boolean | null> } | undefined => {
    const held = (typeof value === 'object' && value !== null ? value : {}) as Bag;
    if (typeof held.id !== 'string') return undefined;
    const values = typeof held.config === 'object' && held.config !== null ? held.config as Bag : undefined;
    if (values === undefined) return { id: held.id };
    const config: Record<string, string | number | boolean | null> = {};
    for (const [key, one] of Object.entries(values)) {
      if (one === null || ['string', 'number', 'boolean'].includes(typeof one))
        config[key] = one as string | number | boolean | null;
    }
    return Object.keys(config).length === 0 ? { id: held.id } : { id: held.id, config };
  };

  /**
   * Who a message came from, read off the message itself, and what it picked.
   *
   * `Message.origin` is required by the protocol, `message._meta` and
   * `message.agent` are optional, and a backend's `begin`/`queue` take them as
   * `from` because a `Session` is handed the words rather than the whole
   * envelope. Starting a turn without them is how a person's own message comes
   * back with no origin, and a client then has nothing to draw a bubble from.
   *
   * The agent is read here rather than left to the caller, because every send
   * path already goes through this and the pick is on the message rather than
   * on the action: `origin` and `_meta` are read the same way, and a message
   * that carries only an agent is a person who picked one and said nothing
   * else.
   */
  const messageFrom = (message: Record<string, unknown>): MessageFrom | undefined => {
    const origin = typeof message.origin === 'object' && message.origin !== null
      ? message.origin as MessageFrom['origin']
      : undefined;
    const meta = typeof message._meta === 'object' && message._meta !== null
      ? message._meta as Bag
      : undefined;
    const picked = typeof message.agent === 'object' && message.agent !== null
      && typeof (message.agent as Bag).uri === 'string'
      ? { uri: (message.agent as Bag).uri as string }
      : undefined;
    if (origin === undefined && meta === undefined && picked === undefined) return undefined;
    return {
      ...(origin === undefined ? {} : { origin }),
      ...(meta === undefined ? {} : { _meta: meta }),
      ...(picked === undefined ? {} : { agent: picked }),
    };
  };

  /**
   * What a client attached to its message, read off the message itself.
   *
   * `Message.attachments` is optional and a client that sent none says nothing,
   * so an empty list is no list rather than an empty one. The backend is handed
   * them as they arrived rather than a rendering of them: an agent that can
   * read an image reads the image, and what it cannot is said in the turn's own
   * text rather than here, which is the backend's call to make.
   */
  const messageAttachments = (message: Record<string, unknown>): MessageAttachment[] | undefined => {
    if (!Array.isArray(message.attachments)) return undefined;
    const held = message.attachments.filter((one) => typeof one === 'object' && one !== null) as MessageAttachment[];
    return held.length === 0 ? undefined : held;
  };

  /**
   * Start a session.
   *
   * At host scope rather than inside a connection because there are two ways
   * in and only one of them has a client: `createSession` is a request
   * somebody made, and an automation coming round at nine in the morning is
   * not. Both need the same eight steps, and a second copy of them would be a
   * second answer to what creating a session means.
   *
   * `by` is who asked: whose the work belongs to, and the person behind a
   * `user:` owner, which is what a later scope change is resolved against. An
   * automation carries a name rather than a connection, so it passes the first
   * and leaves the second to the directory.
   */
  const openSession = (
    uri: string,
    provider: string,
    config: Record<string, unknown>,
    where: string | undefined,
    origin?: { kind: 'automation'; automation: string; run: string },
    credentials?: Record<string, string>,
    additional?: string[],
    title?: string,
    by?: { owner?: Owner; principal?: Principal; sender?: Connection },
  ): void => {
    named(uri, 'session');
    if (sessions.has(uri))
      throw new RpcError(-32003, `${uri} already exists`);
    ctx.unheld(uri);
    const agent = ctx.agents.get(provider);
    if (!agent)
      throw new RpcError(-32002, `No provider called ${provider}`);
    // Whose this is, written down beside the session rather than in its config:
    // a backend is handed `config` when it resumes and has no idea what an
    // owner is, and this outlives the process that decided it.
    if (by?.owner !== undefined) {
      kept.setOwner(idOf(uri), by.owner);
      if (by.principal !== undefined) principals.set(by.owner, by.principal);
    }
    try {
      const lead = spawn(agent, uri, chatUriFor(uri), config, undefined, where, credentials, additional, by?.sender);
      // Named before it is announced, when the maker had a name for it: a
      // row that appears as "New session" and is renamed a moment later is
      // two rows to a client that lists once. Written down for the same
      // reason a rename is: a first name outlives a restart too.
      if (title !== undefined) { lead.setTitle?.(title); keepTitle(uri, chatUriFor(uri), title); }
      // What it was made with, so a resume after a restart starts from the
      // same place rather than from the defaults.
      if (Object.keys(config).length > 0) kept.setConfig(idOf(uri), { ...config });
      // Which harness this one runs on, so a catalogue two agents both list
      // can say whose row it is.
      keepProvider(uri, agent, lead);
    }
    catch (error) {
      // The backend's own words. It is the thing that knows which
      // directories it serves, and a refusal a client can read beats an
      // internal error it cannot.
      throw new RpcError(-32602, error instanceof Error ? error.message : String(error));
    }
    /*
     * The branch it started on, when that is already known.
     *
     * A directory whose facts have answered holds the pull requests the
     * branch had, and this session began after that answer, so they are its
     * baseline. Where nothing has answered yet the capture waits for the
     * first answer, which is the same moment one turn later.
     */
    const facts = dirOf(uri) === undefined ? undefined : githubFacts.get(dirOf(uri) as string);
    if (facts !== undefined) {
      const urls = Array.isArray(facts.pullRequestUrls)
        ? facts.pullRequestUrls.filter((one): one is string => typeof one === 'string')
        : [];
      captureBaseline(uri, urls);
    }
    if (origin !== undefined) origins.set(uri, origin);
    log(`created ${uri}${where ? ` in ${where}` : ''}`);
    // Ready, then announced. A client that hears about a session before
    // it can be subscribed to has been told about something that is not
    // there yet.
    dispatch(uri, { type: 'session/ready' });
    sessionAdded(uri);
    activeSessionsMoved();
    // Named and in the map, which is the moment a handler can act on it.
    void fire({ type: 'session_start', session: uri, provider });
  };

  return {
    removeSession, restart, moveSession, restartChat, backendsOwn, isolated,
    beginOrRun, beginTurn, modelIn, messageFrom, messageAttachments, openSession,
  };
}