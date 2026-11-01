import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { computerId } from '../machines/computers.js';
import { deleteNested } from '../sessions/nested.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { idOf, uriFor, Status } from '../sessions/catalog.js';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { worktreeFor, worktreesOf } from '../repo/worktrees.js';
import { ROOT, chatIdFor, chatUriFor, named } from './channels.js';
import { mayUseAgent, mayUseAgentFor, ownershipOf } from '../agents/usable.js';
import { keepChatAttachment, resolveChatAttachment } from './chatattachment.js';
import { openLink } from '../tools/session.js';
import { readCreatedBy, readOrigin } from '../sessions/remotesession.js';
import { BANG, HOSTS_OWN } from './common.js';
import { BINDINGS_KEY, checkBindings } from '../connectors/bindings.js';
import { commandTurnKey, startsRead } from './chatactions.js';
import { autoApproved, requireTrust } from './trust.js';
import type { Bag } from '../types/common.js';
import type { Session, MessageAttachment, MessageFrom } from '../types/session.js';
import type { MessageChatAttachment } from '@microsoft/agent-host-protocol';
import type { Owner } from '../types/usage.js';
import type { Principal } from '../types/users.js';
import type { Connection } from '../types/host.js';
import type { Agent } from '../types/agent.js';
import type { StoredWorktree } from '../types/sessions.js';
import type { Worktrees } from '../types/worktrees.js';
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
 * What a message's attachments are for the backend, or why there are none.
 *
 * Resolving a `chat` attachment reads another chat, and two things there are
 * the sender's to answer for: a turn that is not a completed one cannot be the
 * end of a transcript, and a chat of a session the sender may not read is not
 * one this host reads out for them. Either is a refusal of the message rather
 * than of the attachment, because a turn whose attachment was dropped is a
 * turn the person does not know the agent never saw.
 *
 * A refusal is answered rather than thrown, which is why this is a shape and
 * not an exception: this runs on the path that applies an action, and a throw
 * there escapes with the client's own optimistic turn still standing.
 */
export type Attached =
  | { attachments?: MessageAttachment[] | undefined; refusal?: undefined }
  | { refusal: string; attachments?: undefined };

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
  /**
   * The sessions a restart has taken out of `sessions` and not yet put back, by
   * uri. A listing counts them as running, so it never prunes their records.
   */
  respawning: Map<string, Held>;
  /**
   * Start a session again, in the directory its config now names.
   *
   * `tokensFor` reads the asking connection's credentials by provider. The
   * credentials argument is the session's own backend's, and a chat that runs
   * on another backend has to be started with that backend's tokens: a token
   * for one resource is not a token for another.
   */
  restart(
    uri: string,
    credentials: Record<string, string>,
    keeping?: { additional?: string[]; directory?: string },
    sender?: Connection,
    before?: BeforeWorktree,
    tokensFor?: (provider: string) => Record<string, string>,
  ): Promise<void>;
  /** The move `set_workspace` asked for, once the turn that asked is over. */
  moveSession(uri: string, move: Move): Promise<void>;
  /** Start one chat again, in the directories it now has. */
  restartChat(uri: string, chatUri: string, credentials: Record<string, string>, sender?: Connection): void;
  /** The name a backend is handed for one chat, which is the id a restart resumes it by. */
  chatIdOf(uri: string, chatUri: string, own: string | undefined): string | undefined;
  /** The backend's own copy of one chat's conversation, gone. */
  deletedChat(backendId: string, agent: Agent, directory: string | undefined): Promise<unknown>;
  /**
   * The backend that serves one chat: the chat's own, or the session's.
   *
   * A chat opened on a backend the session does not run on is served by that
   * one wherever it is started again, and every other chat by the session's.
   */
  chatAgent(held: Held, chatUri: string): Agent;
  /** The config that chat runs on: the chat's own where it has one, the session's otherwise. */
  chatConfig(held: Held, chatUri: string): Record<string, unknown>;
  /** What the backend is given: everything except what this host answered. */
  backendsOwn(config: Record<string, unknown>): Record<string, unknown>;
  /** Where a session actually runs, once isolation has been answered. */
  isolated(
    uri: string,
    config: Record<string, unknown>,
    where: string | undefined,
    before?: BeforeWorktree,
  ): Promise<string | undefined>;
  /**
   * An archived session's tree taken away once the session has stopped, with
   * its branch kept for `restore`. `after` is what has to settle first: the
   * close of the agents that ran in the tree.
   */
  shelve(uri: string, after?: Promise<unknown>): Promise<void>;
  /** A session's tree put back at its path on its branch, where `shelve` took it. */
  restore(uri: string): Promise<void>;
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
  /**
   * What a client attached to its message, for the backend to read.
   *
   * The sender decides for one thing only - whether a referenced chat is read
   * out at all - and is absent where nobody sent the message.
   */
  messageAttachments(message: Record<string, unknown>, sender?: Connection): Attached;
  /** Start a session, with what its request asked to be told, offered and shaped by. */
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
    asked?: { instructions?: string[]; tools?: string[]; userSettings?: boolean },
  ): void;
}

/**
 * The folders a session's config asks to have linked into its tree.
 *
 * Read as an array only, since a value from the wire is `unknown`, and handed
 * on as a list of its own.
 */
export const symlinkFolders = (config: Record<string, unknown>): string[] => {
  const wanted = config.worktreeSymlinkFolders;
  return (Array.isArray(wanted)
    ? wanted.filter((one): one is string => typeof one === 'string')
    : []).map((one) => one.trim()).filter((one) => one !== '');
};

/** The message of the commit that saves a dirty tree before archive removes it. */
const ARCHIVE_COMMIT_MESSAGE = 'Saving uncommitted changes before archiving session';

export function createLifecycle(ctx: HostContext): Lifecycle {
  const {
    options, sessions, byChat, subagents, owners, kept, decided, offered, worktrees, worktreeOf, origins,
    drafts, madeFrom, resumedSessions, githubFacts, principals, presence, marks, lives, beside, detached,
    dispatch, broadcast, flushDeltas, log, fire, sessionEvents, leadOf, chatOf,
    dirOf, changesetOf, stopUnwatched, captureBaseline,
    sessionMachines, enteredIn, inMachine, takeOut, placedIn, followOf,
    isolating, charged, senders, sentBy, forgetSender, forgetSendersIn, forgetKeys, keepKeys,
    checked, principalFor, machineFor, ownerFor,
    contributedDefaults, rootConfig,
    spawn, keepTitle, keepProvider, forgetChats,
    sessionAdded, forgetSent, activeSessionsMoved,
  } = ctx;

  const respawning = new Map<string, Held>();

  /** The folders linked into a session's tree, from the config it was made with. */
  const linkedOf = (uri: string): string[] => symlinkFolders(kept.config(idOf(uri)) ?? decided.get(uri) ?? {});

  /**
   * Why a tree's `HEAD` keeps it, or undefined when it is on the branch the
   * tree was made with.
   *
   * Removing a tree deletes its own `HEAD` reflog, so commits made on a
   * detached `HEAD` would be left unreachable, and a tree on another branch
   * is not the one its record names. A port that cannot say keeps the tree.
   */
  const offBranch = async (port: Worktrees, tree: StoredWorktree & { branch: string }): Promise<string | undefined> => {
    if (port.head === undefined) return 'this host cannot tell which branch it has checked out';
    const head = await port.head(tree.path).catch(() => undefined);
    if (head === tree.branch) return undefined;
    return head === undefined
      ? `its HEAD is not on a branch, so ${tree.branch} may not hold its commits`
      : `it has ${head} checked out rather than ${tree.branch}`;
  };

  /**
   * Everything a session this daemon is holding took with it.
   *
   * The part of a delete that is the host's own: the chats closed, the
   * terminals they claimed killed, the worktree removed if clean, the run that
   * started it unlinked, and everything this host kept *about* the session
   * let go. What the backend keeps is the backend's, and `removeSession` asks
   * for it once this is done and what it answers has settled: every chat's
   * agent stopped. An agent still exiting writes the last of its copy as it
   * goes, as a Claude CLI does, so a copy deleted before then comes back.
   */
  const teardown = (held: Held, uri: string): Promise<void> => {
    // First, while the chats are still here to be recognised: a closed chat is
    // one no map names, and a record left behind is a row nothing can reach.
    ctx.background.forgetSession(uri);
    const closing: Promise<void>[] = [];
    for (const [chatUri, chat] of held.chats) {
      // The senders of what this chat still holds, because a closed backend
      // ends no turn and runs nothing it had queued.
      forgetSendersIn(chat.chatState());
      // This is a removal, one of the two roads that dispose: a session that
      // is gone from here is gone inside its machine as well.
      closing.push(Promise.resolve(chat.close('dispose')).catch(() => {}));
      byChat.delete(chatUri);
      drafts.delete(chatUri);
      madeFrom.delete(chatUri);
      ctx.links.forgetChat(chatUri);
      // The chat is gone with the session, so its canvases are too. Said
      // nothing, because nothing can reach the channel any more.
      ctx.canvases.forgetChat(chatUri);
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
    const tree = worktreeOf(uri);
    if (tree) {
      worktrees.delete(uri);
      kept.setWorktree?.(idOf(uri), undefined);
      const port = options.worktrees;
      // Read now: the session's config is forgotten below, before the check runs.
      const linked = linkedOf(uri);
      void (async () => {
        if (port === undefined) return;
        // A tree made on an existing checkout has no branch of its own to
        // compare `HEAD` with, and goes on the dirty check alone.
        const why = tree.branch === undefined ? undefined : await offBranch(port, { ...tree, branch: tree.branch });
        if (why !== undefined) {
          log(`kept ${tree.path}: ${why}`);
          return;
        }
        if (await port.dirty(tree.path, linked).catch(() => true) !== false) {
          log(`kept ${tree.path}: it has changes nobody committed`);
          return;
        }
        await port.remove(tree.repository, tree.path, tree.branch, linked)
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
     * host's copy made for that one session. A machine
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
    // What this host learned about the session's chats goes with the record
    // they came from: a chat of a session that is gone is reachable by nobody,
    // and its backend id is the backend's business again.
    forgetChats(idOf(uri));
    kept.forget(idOf(uri));
    offered.delete(uri);
    owners.delete(uri);
    lives.delete(uri);
    for (const channel of [...ctx.shown.keys()]) {
      if (changesetOf(channel, uri)) ctx.shown.delete(channel);
    }
    activeSessionsMoved();
    return Promise.all(closing).then(() => undefined);
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
   * The backend's own copy of one chat's conversation, gone.
   *
   * `deleted` names a session by its URI, and a chat's conversation has no URI
   * on this host: the id the backend keeps it under is all there is. It is the
   * same question and so the same answer, one log line and one returned
   * failure included.
   */
  const deletedChat = (backendId: string, agent: Agent, directory: string | undefined): Promise<unknown> =>
    deleted(uriFor(backendId), agent, directory);

  /**
   * A nested session's copy inside its machine, gone.
   *
   * Only for a session this host is not running: a running one is disposed
   * inside by its own close, which reaches the machine on the way down. What is
   * left is a row this host lists from its record while the machine still holds
   * the session - a stop whose dispose never landed, a daemon that was killed,
   * a machine that came back - and the profile of that machine is what decides
   * what happens to it: `inside` starts a host in the machine for the one
   * question, `record` leaves the transcript where it is.
   *
   * The plugin the session's agent was registered by is what the host inside is
   * started with, or the plugin and the record of an agent made from a record,
   * so a record whose plugin this daemon does not have ends with a line rather
   * than with a host that serves nobody.
   */
  const deletedInside = async (uri: string): Promise<void> => {
    const record = kept.nested?.(idOf(uri));
    if (record === undefined) return;
    const computers = options.computers;
    const said = await computers?.nestedDelete?.(record.machine).catch(() => undefined);
    if (said === 'record') return;
    const own = options.agentPlugins?.[record.provider];
    const handed = own === undefined ? await options.handedAgent?.(record.provider).catch(() => undefined) : undefined;
    const plugin = own ?? handed?.plugin;
    if (plugin === undefined) {
      log(`${record.inner} is inside computer://${record.machine}, and this host does not know which plugin serves ${record.provider}, so nothing was deleted there`);
      return;
    }
    await deleteNested({
      id: record.machine,
      plugins: [plugin],
      ...(handed === undefined ? {} : { record: handed.record }),
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
     *
     * The chats come with the directory, and for the same reason: the teardown
     * below drops the record they are read from.
     */
    const directory = dirOf(uri);
    const chats = ctx.heldChats(idOf(uri));
    /*
     * And the checkpoints its turns left in that folder, which are commits
     * under a ref of the session's own: nothing else will ever point at them,
     * so a repository that keeps the refs keeps them for ever.
     *
     * A source that cannot remove them is not a session that stays: what is
     * left behind is a ref in somebody's repository, not a row.
     */
    if (directory !== undefined) {
      try { await options.changes?.removeCheckpoints?.(directory, idOf(uri)); }
      catch { /* the session goes either way */ }
    }
    if (held !== undefined) await teardown(held, uri);
    else await deletedInside(uri);
    let failure = await deleted(uri, agent, directory);
    /*
     * And every chat of it, each a conversation of its own that the backend
     * keeps under an id of its own. Closed ones included: their conversation
     * is still in the backend, and it is this session's rather than a row of
     * its own. Each stays claimed until this runs, so nothing lists one
     * between the session going and its conversation following it.
     */
    for (const chat of chats) {
      if (chat.backendId === '' || chat.backendId === idOf(uri)) continue;
      /*
       * The backend that holds this chat's conversation, which is the chat's
       * own where it ran on one - a transcript belongs to the harness that
       * wrote it, and a delete handed to another is a delete of nothing. A
       * session this host is not holding answers it from the record, which is
       * where it says which backend the chat belonged to.
       */
      const served = chat.provider !== undefined
        ? ctx.agents.get(chat.provider) ?? agent
        : held === undefined ? agent : chatAgent(held, chat.uri);
      const gone = await deletedChat(chat.backendId, served, directory);
      if (failure === undefined) failure = gone;
    }
    if (held === undefined) {
      // Nothing was held, so nothing was torn down and what this host kept
      // about the row is still here: the backend has it, and the host does
      // not need to.
      forgetChats(idOf(uri));
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
    tokensFor?: (provider: string) => Record<string, string>,
  ): Promise<void> => {
    const held = sessions.get(uri);
    if (!held) return;
    /*
     * What one chat's own backend is started with.
     *
     * The credentials the caller brought are the session's backend's, and a
     * chat that runs on another one is started with that backend's: a token
     * for one resource is not a token for another. The asking connection is
     * where they are read from, and a restart nobody's connection asked for
     * starts the chat with none.
     */
    const credentialsOf = (chat: string): Record<string, string> => {
      const agent = chatAgent(held, chat);
      if (agent === held.agent) return credentials;
      return tokensFor?.(agent.provider) ?? {};
    };
    const mine = decided.get(uri) ?? {};
    // The repository rather than the worktree: the choice is made against the
    // directory somebody asked for, and a worktree is only where a previous
    // answer put it. Or the directory a move asked for, which is neither.
    const from = keeping?.directory ?? worktreeOf(uri)?.repository ?? held.workingDirectory;
    const was = worktreeOf(uri);
    if (was) {
      worktrees.delete(uri);
      kept.setWorktree?.(idOf(uri), undefined);
      // Removed without asking whether it is dirty, unlike a disposed session:
      // nothing has ever run in this one, so there is nothing in it to keep.
      await options.worktrees?.remove(was.repository, was.path, was.branch, linkedOf(uri))
        .then(() => { log(`removed ${was.path}`); })
        .catch((error: unknown) => {
          log(`kept ${was.path}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }
    const to = await isolated(uri, mine, from, before);
    const wasAt = held.workingDirectory;
    // The first folder every client holds the session at, as its backend reports it.
    const shown = leadOf(held)?.workingDirectories()[0];
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
      stopping.push(Promise.resolve(chat.close('stopping')));
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
    respawning.set(uri, held);
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
        chatAgent(held, held.defaultChat),
        uri,
        held.defaultChat,
        chatIdOf(uri, held.defaultChat, lead?.agentId()),
        backendsOwn(chatConfig(held, held.defaultChat)),
        talking,
        to,
        credentialsOf(held.defaultChat),
        keeping?.additional ?? held.additional,
        sender,
      );
      /*
       * And every other chat of the session, which comes back with it.
       *
       * A peer chat is a conversation of its own, with a transcript of its own
       * the backend keeps under an id of its own - so the session coming back
       * is not the whole of what has to come back. Each is respawned the way
       * `restartChat` respawns one: under its own URI, resumed as its own
       * conversation, with its own turns when the backend cannot resume.
       *
       * Read from `held.chats` rather than from the store, because these are
       * the chats this process was holding and their turns are in memory: the
       * record is what a later process reads, and this one still has the
       * conversation itself. `spawn` writes the record again as it goes.
       */
      for (const [chatUri, chat] of held.chats) {
        if (chatUri === held.defaultChat) continue;
        const own = chat.agentId();
        spawn(
          chatAgent(held, chatUri),
          uri,
          chatUri,
          // The name the backend answered with, where it minted one: the record
          // is written again here, and a chat resumed by one name while
          // recorded under another is one the next start reads as missing.
          chatIdOf(uri, chatUri, own),
          backendsOwn(chatConfig(held, chatUri)),
          own === undefined ? undefined : { resume: own, seed: chat.allTurns() },
          to,
          credentialsOf(chatUri),
          beside.get(chatUri) ?? keeping?.additional ?? held.additional,
          sender,
        );
      }
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
    finally {
      respawning.delete(uri);
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
     * The first folder moved, said with the protocol's one action for a root
     * that moves: `workingDirectoryReplaced`, from the folder it was to the
     * folder it is, so no client holds the session with no folder at all. A
     * session that had no first folder is given one by a set.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts
     */
    if (to !== undefined) {
      dispatch(uri, shown === undefined
        ? { type: 'session/workingDirectorySet', directory: uriOf(to) }
        : { type: 'session/workingDirectoryReplaced', directory: shown, replacement: uriOf(to) });
    }
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
     * its yes.
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
       * host made is trusted exactly when its repository is. The repository the window
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
      undefined,
      ctx.turnInstructions(uri),
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
    // Read before the chat is closed, and kept: the name the backend answered
    // with is what the record is written under, and what the new process
    // resumes.
    const own = chat.agentId();
    const talking = own !== undefined ? { resume: own, seed: chat.allTurns() } : undefined;
    /*
     * Started again rather than removed, which is what the chat coming back
     * resumed needs: told a removal, a backend running nested in a machine
     * disposes the session inside, and the chat that starts behind it opens
     * on a transcript that is gone.
     */
    chat.close('stopping');
    held.chats.delete(chatUri);
    byChat.drop(chatUri);
    spawn(
      chatAgent(held, chatUri),
      uri,
      chatUri,
      chatIdOf(uri, chatUri, own),
      backendsOwn(chatConfig(held, chatUri)),
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
   * The backend that serves one chat.
   *
   * A chat opened on another backend runs on that one - what a start hands it,
   * whose credentials it is asked for, whose transcript a rewind resumes and
   * what a delete removes - and every other chat of the session runs on the
   * session's own. The session keeps its own either way: what a client reads
   * as its provider and what a resume records are the session's, not a chat's.
   */
  const chatAgent = (held: Held, chatUri: string): Agent => held.backends.get(chatUri)?.agent ?? held.agent;

  /** The config one chat runs on: its own where it has a backend of its own, the session's otherwise. */
  const chatConfig = (held: Held, chatUri: string): Record<string, unknown> =>
    held.backends.get(chatUri)?.config ?? held.config;

  /**
   * The name a backend is handed for a chat, on a start that is not the first.
   *
   * The chat's own name where the backend minted one, which is what a restart
   * writes into the record and what the next process resumes; none at all for
   * the chat that is the session, whose name the backend derives from the
   * session URI and which is never handed one.
   */
  const chatIdOf = (uri: string, chatUri: string, own: string | undefined): string | undefined =>
    chatUri === chatUriFor(uri) ? undefined : own ?? chatIdFor(uri, chatUri);

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
      throw new RpcError(INVALID_PARAMS, `${where} is not a git repository, so it has no worktrees`);
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
    // The folders to link.
    const symlink = symlinkFolders(config);
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
    // removal time either deletes nothing or names somebody else's. The commit
    // it was cut from is remembered for the same reason: the tree moves on, and
    // what it started from is only knowable while it is still that.
    const commit = await port.commitOf?.(path);
    const made = {
      repository, path, base,
      ...(branch !== undefined ? { branch } : {}),
      ...(commit !== undefined ? { commit } : {}),
    };
    worktrees.set(uri, made);
    kept.setWorktree?.(idOf(uri), made);
    log(`made ${path} on ${branch ?? base} for ${uri}`);
    return path;
  };

  /**
   * The removal and the restore of each session's tree, by session id, as one
   * chain: an archive and an unarchive sent together run in the order they
   * were sent, and a wake waits for the tree the archive was taking away.
   */
  const shelving = new Map<string, Promise<void>>();

  // What archive does with a dirty tree, from the host's own option: set here
  // because `shelve` is where it is read.
  ctx.archiveDirtyWorktree = options.archiveDirtyWorktree ?? 'keep';

  /** One step on a session's chain, run once the step before it has settled. */
  const inTurn = (uri: string, step: () => Promise<void>): Promise<void> => {
    const id = idOf(uri);
    const next = (shelving.get(id) ?? Promise.resolve()).then(step).catch((error: unknown) => {
      log(`worktree of ${uri}: ${error instanceof Error ? error.message : String(error)}`);
    });
    shelving.set(id, next);
    void next.then(() => { if (shelving.get(id) === next) shelving.delete(id); });
    return next;
  };

  /** Whether something is at a path. */
  const present = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

  /** Whether the window holds a handle on the session's tree, which leaves the tree to it. */
  const handled = (uri: string): boolean => [...detached.values()].some((one) => one.session === uri);

  /** Whether a session is archived now, read when the step runs rather than when it was asked for. */
  const archivedNow = (uri: string): boolean => (kept.flags(idOf(uri)) & Status.IsArchived) !== 0;

  /*
   * An archived session's tree, given back.
   *
   * Only once the session has stopped, and only while it is still archived:
   * an unarchive sent before this step ran is the person changing their mind.
   * The record stays, since it is what `restore` puts the tree back from.
   *
   * Removed without its branch, which is what makes it come back: the branch
   * holds every commit the session made, and the tree is only a checkout of
   * it. So a tree with no branch of its own stays, because a checkout of
   * somebody's branch or of a bare commit is not this session's to give
   * back, and neither is a tree whose `HEAD` has left the branch: commits
   * made on a detached `HEAD` or on another branch are not on the branch a
   * restore checks out. A dirty tree stays, because work nobody committed
   * has nowhere to come back from, unless `archiveDirtyWorktree` is
   * `commit`: then the work is committed on the branch first, and the tree
   * goes only once git says it is clean. The folders this host linked into
   * the tree are not work, and are neither counted nor committed.
   */
  const shelve = (uri: string, after?: Promise<unknown>): Promise<void> => inTurn(uri, async () => {
    await after?.catch(() => undefined);
    const port = options.worktrees;
    const tree = worktreeOf(uri);
    if (port === undefined || tree === undefined || !archivedNow(uri) || sessions.has(uri) || handled(uri)) return;
    if (!await present(tree.path)) return;
    if (tree.branch === undefined) {
      log(`kept ${tree.path}: it has no branch of its own to come back on`);
      return;
    }
    const why = await offBranch(port, { ...tree, branch: tree.branch });
    if (why !== undefined) {
      log(`kept ${tree.path}: ${why}`);
      return;
    }
    const linked = linkedOf(uri);
    const clean = async (): Promise<boolean> => await port.dirty(tree.path, linked).catch(() => true) === false;
    /*
     * An archive the host made itself never commits and never loses a commit:
     * the tree goes only when it is clean and its branch is on a remote as it
     * is here, whatever `archiveDirtyWorktree` says.
     */
    if (kept.autoArchivedAt?.(idOf(uri)) !== undefined) {
      if (!await clean()) {
        log(`kept ${tree.path}: it has changes nobody committed`);
        return;
      }
      if (port.pushed === undefined) {
        log(`kept ${tree.path}: this host cannot tell whether its branch is pushed`);
        return;
      }
      if (!await port.pushed(tree.path).catch(() => false)) {
        log(`kept ${tree.path}: its branch has no upstream or has commits nobody pushed`);
        return;
      }
    }
    else if (!await clean()) {
      if (ctx.archiveDirtyWorktree !== 'commit') {
        log(`kept ${tree.path}: it has changes nobody committed`);
        return;
      }
      if (port.commit === undefined) {
        log(`kept ${tree.path}: it has changes nobody committed, and this host cannot commit them`);
        return;
      }
      if (sessions.has(uri) || !archivedNow(uri) || handled(uri)) return;
      const failed = await port.commit(tree.path, ARCHIVE_COMMIT_MESSAGE, linked).then(() => undefined, (error: unknown) =>
        error instanceof Error ? error.message : String(error));
      if (failed !== undefined) {
        log(`kept ${tree.path}: could not commit its changes: ${failed}`);
        return;
      }
      if (!await clean()) {
        log(`kept ${tree.path}: it still has changes after the commit`);
        return;
      }
      log(`committed the changes in ${tree.path} on ${tree.branch}`);
    }
    // Asked again after the check, which waited: a session started in the
    // tree meanwhile, or an unarchive, keeps it.
    if (sessions.has(uri) || !archivedNow(uri) || handled(uri)) return;
    await port.remove(tree.repository, tree.path, undefined, linked)
      .then(() => { log(`removed ${tree.path} for the archived ${uri}, keeping ${tree.branch ?? ''}`); })
      .catch((error: unknown) => {
        log(`kept ${tree.path}: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

  /*
   * A session's tree, put back where `shelve` took it.
   *
   * At the same path on the same branch, with the folders the session asked
   * to have linked linked again. The include files are not copied again: they
   * were copies, and the branch has what the session made of them.
   *
   * Nothing to do for a session with no record or whose tree is there, and
   * nothing for a tree the window holds a handle on, which its own method
   * puts back.
   */
  const restore = (uri: string): Promise<void> => inTurn(uri, async () => {
    const port = options.worktrees;
    const tree = worktreeOf(uri);
    if (port === undefined || tree === undefined || handled(uri)) return;
    if (await present(tree.path)) return;
    if (tree.branch === undefined) {
      log(`could not put ${tree.path} back: it has no branch of its own`);
      return;
    }
    const symlink = linkedOf(uri);
    await port.create({
      repository: tree.repository,
      base: tree.branch,
      path: tree.path,
      ...(symlink.length > 0 ? { symlink } : {}),
    })
      .then(() => { log(`put ${tree.path} back on ${tree.branch ?? ''} for ${uri}`); })
      .catch((error: unknown) => {
        log(`could not put ${tree.path} back: ${error instanceof Error ? error.message : String(error)}`);
      });
  });

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
    /*
     * The keys the turn's check chose, once it has allowed the turn.
     *
     * Held here rather than in the map until `run` knows the turn will be
     * begun: a message refused for the turn already running is not a turn, and
     * a key left behind for it would be a record's key nobody writes.
     */
    let keys: string[] | undefined;
    const run = (): string | undefined => {
      /*
       * Who sent it, against the id this turn will be known by: the turn id when
       * it starts now, and the queued message's id when it waits its turn. A
       * queued message is one turn that has not been given an id yet, and the
       * backend says which turn it became when it runs - so the sender is moved
       * across there rather than looked for here under an id it will never
       * carry again.
       */
      const command = text.startsWith(BANG) ? text.slice(BANG.length).trim() : '';
      /*
       * One turn at a time in a chat, for the turns that ask the agent.
       *
       * A message asking for a turn while one is running is refused here, in
       * the words the client shows, rather than handed to a backend that would
       * have to drop it or lose the turn in front of it. A command is left
       * out: it queues behind the running turn by its own road, and a message
       * that waited its turn arrives under `queuedAs` and is begun by the
       * backend when that turn ends.
       */
      if (queuedAs === undefined && (command === '' || !options.terminals)
        && session.chatState().activeTurn !== undefined) return 'A turn is running in this chat';
      if (who !== undefined) senders.set(queuedAs ?? turnId, who);
      // And the window itself, under the same id, for whatever has to ask it
      // something later - the move an agent asks for in this turn most of all.
      if (sender !== undefined) sentBy.set(queuedAs ?? turnId, sender);
      // What its records are charged under, under the same id for the same
      // reason: a queued message becomes a turn the backend names later, and
      // its keys are moved to that id beside its sender.
      if (keys !== undefined) keepKeys(queuedAs ?? turnId, keys);
      if (command === '' || !options.terminals) {
        /*
         * With what this turn is told, decided by the backend when it begins.
         *
         * The one place a message becomes a turn, whoever sent it and whichever
         * way it arrived - so this is where every turn of a session is given
         * the same thing, and the only thing that decides it is what the
         * session holds at the moment the turn starts.
         */
        if (queuedAs === undefined) session.begin(turnId, text, model, from, attachments, ctx.turnInstructions(session.uri));
        else session.queue(queuedAs, text, model, from, attachments, ctx.turnInstructions(session.uri));
        return undefined;
      }
      if (!session.ran) {
        // Refused, so no turn will ever end under this id to let its sender go.
        forgetSender(queuedAs ?? turnId);
        forgetKeys(queuedAs ?? turnId);
        return `${provider} cannot run a command in a turn; use a terminal instead`;
      }
      ctx.commandTurns.set(commandTurnKey(session.chatUri, queuedAs ?? turnId), false);
      const first = session.workingDirectories()[0];
      const where = first === undefined ? options.path : localPath(first);
      session.ran(turnId, command, (toolCallId, opened) => ctx.commanded(command, where, {
        kind: 'session',
        session: session.uri,
        chat: session.chatUri,
        turnId,
        toolCallId,
      }, opened), queuedAs);
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
    /*
     * The turn is charged, unlike the session, because this is where what a
     * limit counts is about to be spent. The walk's keys are held for the
     * meter, which is what writes the turn's records under them.
     */
    return checked(principal, charged.get(session.uri)?.scope, [{
      kind: 'agent',
      asked: {
        agent: provider,
        computer: machineFor(held?.config ?? {}),
        ...(model === undefined ? {} : { model: model.id }),
      },
    }], 'agent').then((found) => {
      if (found.refusal !== undefined) return found.refusal;
      if (found.pools !== undefined && found.pools.length > 0) keys = found.pools;
      return turn();
    });
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
   * Whether one attachment is a reference to another chat.
   *
   * Read off the wire rather than trusted as a type, the way every other
   * field of a message is: `attachments` is whatever a client sent, and the
   * discriminant is the only thing that says what each one is.
   */
  const isChat = (one: MessageAttachment): one is MessageChatAttachment => String(one.type) === 'chat';

  /**
   * Whether the sender may read the session a referenced chat is in.
   *
   * Asked only where there is somebody to ask. A host with no user directory
   * has no principal anywhere and refuses nothing, so every sender reads every
   * transcript - and so does a socket on the deployment's own token, which is
   * the host rather than a person on it.
   *
   * Otherwise it is the read group of the `session` subject rather than one
   * session's own, which is as narrow as the question can be made: a read grant
   * on this host is by subject and not by session, so there is no per-session
   * answer to look up - the same reading `automations.ts` takes of an owner
   * with `maySee`.
   *
   * Read as a default: where this cannot say yes, the excerpt is left off and
   * the pointer is all the model gets. A transcript is somebody's conversation
   * and handing it over is the thing that has to be allowed, so the answer that
   * is wrong quietly is the permissive one.
   */
  const mayRead = (sender: Connection | undefined): boolean => {
    if (options.users === undefined) return true;
    if (sender?.root === true) return true;
    return sender?.principal?.can('session:read') === true;
  };

  /**
   * What a client attached to its message, for the backend to read.
   *
   * `Message.attachments` is optional and a client that sent none says nothing,
   * so an empty list is no list rather than an empty one. Everything but a
   * `chat` attachment is handed over as it arrived rather than as a rendering
   * of it: an agent that can read an image reads the image, and what it cannot
   * is said in the turn's own text rather than here, which is the backend's
   * call to make.
   *
   * A `chat` attachment is the one this host has work to do for, because
   * reading another chat is not a backend's to do: it becomes a `simple`
   * attachment whose `modelRepresentation` names the chat, links to it and
   * carries the tail of its transcript - `chatattachment.ts`. The message is
   * never written to, so the turn a client sees still carries the `chat`
   * attachment it sent, and the next reader of that turn resolves it again from
   * its own side.
   *
   * The chat's own turns are read here, and only here: an attachment inside
   * those turns is not resolved again, which is what keeps this a bounded read
   * rather than one that follows references as far as a client cared to write
   * them.
   */
  const messageAttachments = (message: Record<string, unknown>, sender?: Connection): Attached => {
    if (!Array.isArray(message.attachments)) return {};
    const held = message.attachments.filter((one) => typeof one === 'object' && one !== null) as MessageAttachment[];
    if (held.length === 0) return {};
    // Nothing to resolve: the same list, untouched.
    if (!held.some(isChat)) return { attachments: held };

    const attachments: MessageAttachment[] = [];
    for (const one of held) {
      if (!isChat(one)) {
        attachments.push(one);
        continue;
      }
      /*
       * The chat the attachment names, where this host is running it.
       *
       * `chatOf` is what every other reader of a chat URI goes through, so a
       * reference spelt the way this client knows the chat - the default chat's
       * derived name, a peer chat's own name, the older `ahp-chat:/<id>` - is
       * the same chat here as everywhere else. A chat this host is not running
       * has no turns to read and no link to give, and a client can attach one:
       * the reference outlives the session it names, and a message that arrives
       * with it is still a message.
       */
      const named = chatOf(one.resource);
      const live = byChat.get(named);
      const owning = live === undefined ? undefined : sessions.get(live.uri);
      const link = live === undefined || owning === undefined
        ? undefined
        : openLink(live.uri, owning.agent.provider, chatIdFor(live.uri, named));

      if (live === undefined || owning === undefined || !mayRead(sender)) {
        /*
         * Nothing to hand over, and the turn still runs.
         *
         * The pin goes with the transcript rather than being refused here: a
         * turn no reader looked at is not one this host can say it found, and
         * the pointer already says there is nothing up to it. What is left is
         * the reference itself, so the model knows the person meant a chat even
         * where nothing of it can be read out.
         */
        const { endTurn: _unread, ...withoutPin } = one;
        attachments.push(keepChatAttachment(resolveChatAttachment(withoutPin, [], link), one));
        continue;
      }

      /*
       * A turn that is still running cannot be the end of a transcript.
       *
       * Checked against the chat rather than against what was in it when the
       * client was told about it: a turn that started after the completion was
       * offered is exactly the case - the person attaches the chat they are
       * looking at while it is still answering - and the backend's own state is
       * what knows.
       */
      const active = (live.chat.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
      if (one.endTurn !== undefined && typeof active?.id === 'string' && active.id === one.endTurn) {
        return { refusal: `Chat attachment endTurn must reference a completed turn: ${one.resource}#${one.endTurn}` };
      }

      /*
       * And a turn this host cannot find is the same answer for the same
       * reason: a client pinned a transcript this host does not have, so what
       * was attached is not what would be read. `resolveChatAttachment` is what
       * finds it, and says so by throwing.
       */
      try {
        attachments.push(keepChatAttachment(resolveChatAttachment(one, live.chat.allTurns(), link), one));
      } catch (error) {
        return { refusal: error instanceof Error ? error.message : String(error) };
      }
    }

    return { attachments };
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
    asked?: { instructions?: string[]; tools?: string[]; userSettings?: boolean },
  ): void => {
    named(uri, 'session');
    if (sessions.has(uri))
      throw new RpcError(-32003, `${uri} already exists`);
    ctx.unheld(uri);
    const agent = ctx.agents.get(provider);
    if (!agent)
      throw new RpcError(-32002, `No provider called ${provider}`);
    /*
     * And an agent the caller may not use answers the same way, so a start it
     * is refused names no agent it was not told about. A run nobody's window
     * sent - an automation's, a bot's, a tool's - carries no sender, so it is
     * asked of the owner it acts for: a start must not reach an agent that
     * owner could not have started itself.
     */
    const owned = ownershipOf(ctx.options.agentOwners?.(), provider);
    const checked = { hasDirectory: ctx.options.users !== undefined };
    const allowed = by?.sender !== undefined
      ? mayUseAgent(by.principal, owned, { ...checked, root: by.sender.root === true })
      : mayUseAgentFor(by, owned, checked);
    if (!allowed) throw new RpcError(-32002, `No provider called ${provider}`);
    /*
     * A binding names a connector, so a start that carries one is checked
     * here, before anything is written down: the connector has to be one this
     * host serves, of the adapter the URI names, and one the session's owner
     * may read - the check an automation's save makes. Refused here rather
     * than at the first call because the person who set the binding is the one
     * who can fix it, and the model never learns an alias that resolves to
     * somebody else's account.
     */
    checkBindings(config[BINDINGS_KEY], by?.owner, options.connectors?.refs());
    // Whose this is, written down beside the session rather than in its config:
    // a backend is handed `config` when it resumes and has no idea what an
    // owner is, and this outlives the process that decided it.
    if (by?.owner !== undefined) {
      kept.setOwner(idOf(uri), by.owner);
      if (by.principal !== undefined) principals.set(by.owner, by.principal);
    }
    /*
     * Where a window sent this session from, and what made it.
     *
     * Read off the config the session was asked for with, and written down
     * beside it for the reason an owner is: the window that sent it reads both
     * back off the session's summary, and one that was sent here outlives the
     * process that took it. A malformed origin is none at all - the reader
     * refuses what the window's host refuses - so a session is never held with
     * half an origin.
     *
     * Written only where the config carried one, because a session opened
     * again - a row read off disk, a directory added - is the same session and
     * not one this host has just been told about.
     */
    const sentFrom = readOrigin(config);
    if (sentFrom !== undefined) kept.setRemoteOrigin?.(idOf(uri), sentFrom);
    const madeBy = readCreatedBy(config);
    if (madeBy !== undefined) kept.setCreatedBy?.(idOf(uri), madeBy);
    /*
     * The opt-in tools the request asked for, written down before the session
     * spawns: which tools are offered is read off the store while the first
     * turn is being set up, and the names are kept for the reason an owner is
     * - a session opened again after a restart is offered the same tools
     * without the request being repeated. A session that asked for none writes
     * nothing, so a row read back is a session with no names rather than one
     * that asked for an empty list.
     */
    if (asked !== undefined) kept.setTools?.(idOf(uri), asked.tools);
    /*
     * Whether it loads the person's own settings, written down with the tools
     * and for the same reason: the backend reads it when it starts, and a
     * restart that starts the session again has no request to ask. Absent is
     * `true`, so a request that said nothing writes nothing.
     */
    if (asked !== undefined) kept.setUserSettings?.(idOf(uri), asked.userSettings);
    try {
      /*
       * The backend is handed everything but this host's own keys, and the
       * store is handed the lot.
       *
       * `connectors` is why: a binding is read back from the kept config on
       * every tool list, and after a restart that store is the only place it
       * survives. What a backend must not hear about is stripped here rather
       * than by each caller, so a session a tool, an automation or a client
       * starts keeps the keys the same way.
       */
      const lead = spawn(agent, uri, chatUriFor(uri), chatIdFor(uri, chatUriFor(uri)), backendsOwn(config), undefined, where, credentials, additional, by?.sender, asked?.instructions);
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
      throw new RpcError(INVALID_PARAMS, error instanceof Error ? error.message : String(error));
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
    // Read, and its chat with it, before anybody is told about it: a session
    // nobody has said anything in has nothing new in it.
    kept.setFlags(idOf(uri), kept.flags(idOf(uri)) | Status.IsRead);
    startsRead(ctx, uri, chatUriFor(uri));
    log(`created ${uri}${where ? ` in ${where}` : ''}`);
    // Ready, then announced. A client that hears about a session before
    // it can be subscribed to has been told about something that is not
    // there yet.
    dispatch(uri, { type: 'session/ready' });
    sessionAdded(uri);
    activeSessionsMoved();
    // Named and in the map, which is the moment a handler can act on it.
    // The client that asked is named where one did: an automation carries a
    // name rather than a connection, and a session found on disk was started
    // by whoever ran the daemon rather than by anyone here.
    const made = by?.sender?.clientId;
    void fire({
      type: 'session_start',
      session: uri,
      provider,
      ...(made === undefined || made === '' ? {} : { client: made }),
    });
  };

  return {
    removeSession, respawning, restart, moveSession, restartChat, chatIdOf, deletedChat, backendsOwn,
    chatAgent, chatConfig, isolated,
    shelve, restore, beginOrRun, beginTurn, modelIn, messageFrom, messageAttachments, openSession,
  };
}