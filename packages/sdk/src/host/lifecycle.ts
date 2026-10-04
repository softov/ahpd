import { RpcError } from '../rpc.js';
import { computerId } from '../computers.js';
import { idOf } from '../catalog.js';
import { join } from 'node:path';
import { worktreeFor, worktreesOf } from '../repo/worktrees.js';
import { ROOT, chatUriFor, named } from './channels.js';
import { BANG, HOSTS_OWN } from './common.js';
import type { Bag } from '../types/common.js';
import type { Session, MessageAttachment, MessageFrom } from '../types/session.js';
import type { Owner } from '../types/usage.js';
import type { Principal } from '../types/users.js';
import type { HostContext } from './context.js';

/**
 * What happens to a session between being opened and being gone.
 *
 * The restart a move and a new directory both go through, the disposal that
 * ends one, and the turn a message becomes - the checks it answers to, the
 * `!` command it may turn out to be, and the model and origin it carries.
 */
export interface Lifecycle {
  /** A session gone, with everything it held. */
  removeSession(uri: string): void;
  /** Start a session again, in the directory its config now names. */
  restart(
    uri: string,
    credentials: Record<string, string>,
    keeping?: { additional?: string[]; directory?: string },
  ): Promise<void>;
  /** The move `set_workspace` asked for, once the turn that asked is over. */
  moveSession(uri: string, move: { chat: string; directory: string; isolation: boolean }): Promise<void>;
  /** Start one chat again, in the directories it now has. */
  restartChat(uri: string, chatUri: string, credentials: Record<string, string>): void;
  /** What the backend is given: everything except what this host answered. */
  backendsOwn(config: Record<string, unknown>): Record<string, unknown>;
  /** Where a session actually runs, once isolation has been answered. */
  isolated(uri: string, config: Record<string, unknown>, where: string | undefined): Promise<string | undefined>;
  /** A message's turn, whichever way it arrived. */
  beginOrRun(
    session: Session,
    provider: string,
    turnId: string,
    text: string,
    model: ReturnType<Lifecycle['modelIn']>,
    from: MessageFrom | undefined,
    sender?: Owner,
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
    by?: { owner?: Owner; principal?: Principal },
  ): void;
}

export function createLifecycle(ctx: HostContext): Lifecycle {
  const {
    options, sessions, byChat, subagents, owners, kept, decided, offered, worktrees, origins,
    drafts, madeFrom, resumedSessions, githubFacts, principals, presence, marks, lives, beside,
    dispatch, broadcast, log, fire, leadOf,
    dirOf, changesetOf, stopUnwatched, captureBaseline,
    sessionMachines, enteredIn, inMachine, placedIn,
    isolating, charged, senders, checked, principalFor, machineFor,
    spawn, keepTitle, keepProvider,
    sessionAdded, activeSessionsMoved,
  } = ctx;

  /**
   * A session gone, with everything it held.
   *
   * What `disposeSession` does, and what the `delete_session` tool does from
   * inside another session: the chats closed, the terminals they claimed
   * killed, the worktree removed if clean, the run that started it unlinked,
   * and every client told.
   */
  const removeSession = (uri: string): void => {
    const held = sessions.get(uri);
    if (!held)
      throw new RpcError(-32001, `No agent for session ${uri}`);
    for (const [chatUri, chat] of held.chats) {
      chat.close();
      byChat.delete(chatUri);
      drafts.delete(chatUri);
      madeFrom.delete(chatUri);
      ctx.links.forgetChat(chatUri);
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
    const left = enteredIn.get(uri);
    inMachine(left, uri, false);
    enteredIn.delete(uri);
    sessionMachines.delete(uri);
    // Gone from the map first, so a handler asking about it is told the truth.
    void fire({ type: 'session_end', session: uri, reason: 'disposed' });
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
    // Every other client is told, because the session was theirs too.
    // `session`, which is the name the protocol gives it. Under
    // `resource` a client reads `undefined` and takes nothing out, so a
    // disposed session stayed in every catalogue until something else
    // made that client re-read the list.
    broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: uri });
    log(`disposed ${uri}`);
  };

  const restart = async (
    uri: string,
    credentials: Record<string, string>,
    keeping?: { additional?: string[]; directory?: string },
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
    const to = await isolated(uri, mine, from);
    const before = held.workingDirectory;
    // Their names stay the session's while it starts again.
    for (const [chatUri, chat] of held.chats) {
      chat.close();
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
      }
      spawn(
        held.agent,
        uri,
        held.defaultChat,
        backendsOwn(held.config),
        talking,
        to,
        credentials,
        keeping?.additional ?? held.additional,
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
    if (before === to) return;
    /*
     * Replaced, not removed and re-added.
     *
     * Index 0 is the process root, and the protocol has one action for a root
     * that moves: `workingDirectoryReplaced`. Saying it as a removal followed
     * by an addition would be a client briefly holding a session with no
     * directory at all.
     */
    if (to !== undefined) dispatch(uri, { type: 'session/workingDirectoryReplaced', directory: `file://${to}` });
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
  const moveSession = async (uri: string, move: { chat: string; directory: string; isolation: boolean }): Promise<void> => {
    const held = sessions.get(uri);
    if (!held) return;
    decided.set(uri, { ...decided.get(uri), isolation: move.isolation ? 'worktree' : 'folder' });
    offered.set(uri, (await isolating(move.directory, move.isolation ? 'worktree' : 'folder')).schema);
    await restart(uri, {}, { additional: [], directory: move.directory });
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
  const restartChat = (uri: string, chatUri: string, credentials: Record<string, string>): void => {
    const held = sessions.get(uri);
    const chat = held?.chats.get(chatUri);
    if (held === undefined || chat === undefined) return;
    const talking = chat.agentId() !== undefined
      ? { resume: chat.agentId() as string, seed: chat.allTurns() }
      : undefined;
    chat.close();
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
  const isolated = async (uri: string, config: Record<string, unknown>, where: string | undefined): Promise<string | undefined> => {
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
    const path = join(worktreesOf(repository), worktreeFor(branch ?? base));
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
   * A promise only for a turn that had to be asked about: everything else is
   * answered here and now, which is what keeps the actions of a turn in the
   * order they were already written in.
   */
  const beginOrRun = (
    session: Session,
    provider: string,
    turnId: string,
    text: string,
    model: ReturnType<typeof modelIn>,
    from: MessageFrom | undefined,
    sender?: Owner,
    queuedAs?: string,
    attachments?: MessageAttachment[],
  ): string | undefined | Promise<string | undefined> => {
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
    const run = (): string | undefined => {
      /*
       * Who sent it, against the id this turn will be known by: the turn id when
       * it starts now, and the queued message's id when it waits its turn. A
       * queued message is one turn that has not been given an id yet, and the
       * backend says which turn it became when it runs - so the sender is moved
       * across there rather than looked for here under an id it will never
       * carry again.
       */
      if (sender !== undefined) senders.set(queuedAs ?? turnId, sender);
      const command = text.startsWith(BANG) ? text.slice(BANG.length).trim() : '';
      if (command === '' || !options.terminals) {
        if (queuedAs === undefined) session.begin(turnId, text, model, from, attachments);
        else session.queue(queuedAs, text, model, from);
        return undefined;
      }
      if (!session.ran) return `${provider} cannot run a command in a turn; use a terminal instead`;
      const where = session.workingDirectories()[0]?.replace(/^file:\/\//, '') ?? options.path;
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
    const principal = principalFor(sender ?? kept.owner(idOf(session.uri)));
    const store = options.policies;
    if (options.policiesCheck !== true || store === undefined || principal === undefined) return run();
    const held = sessions.get(session.uri);
    return checked(principal, charged.get(session.uri)?.scope, [{
      kind: 'agent',
      asked: {
        agent: provider,
        computer: machineFor(held?.config ?? {}),
        ...(model === undefined ? {} : { model: model.id }),
      },
    }]).then((why) => why === undefined ? run() : why);
  };

  /**
   * A turn begun, or a turn refused, from what `beginOrRun` answered.
   *
   * For the two call sites that stand in a `switch` and cannot wait. An answer
   * that came already is taken at once; one that is still to come is taken when
   * it comes, and a turn nothing refused is begun then as well.
   */
  const beginTurn = (
    begun: string | undefined | Promise<string | undefined>,
    refused: (why: string) => void,
  ): void => {
    if (typeof begun === 'string') refused(begun);
    else if (begun !== undefined) void begun.then((why) => { if (why !== undefined) refused(why); });
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
    by?: { owner?: Owner; principal?: Principal },
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
    // Snapshotted before the backend is handed its tools, so this session's
    // whole life runs under the strategy the root config named at this
    // moment and a later root change waits for the next session.
    ctx.strategies.set(uri, ctx.strategyOf(uri));
    try {
      const lead = spawn(agent, uri, chatUriFor(uri), config, undefined, where, credentials, additional);
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