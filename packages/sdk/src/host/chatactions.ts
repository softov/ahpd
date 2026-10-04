import { idOf, Status } from '../catalog.js';
import { chatUriFor, isRootChannel, MARKS, ROOT, toolCallOfSubagentChat, WORKER_ACTIONS } from './channels.js';
import { HOSTS_OWN } from './common.js';
import type { Bag } from '../types/common.js';
import type { Origin } from './state.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * A session's and a chat's actions.
 *
 * The part of a dispatch that needs the session the action is about: a
 * worker's chat, which is read-only, a session being started again, and the
 * switch that acts on the action once both are known.
 */
export function chatAction(
  ctx: HostContext,
  conn: ConnectionContext,
  params: Record<string, unknown>,
  channel: string,
  action: Record<string, unknown>,
  type: string,
  origin: Origin,
  no: (reason: string) => void,
): Promise<void> | undefined {
  const { connection } = conn;
  const { refuse } = ctx;
  const {
    admitted, beginOrRun, beginTurn, beside, byChat, catalogue, charge, charged, connections,
    contributedDefaults, decided, described, dispatch, drafts, fire, first, keepProvider, kept,
    known, leadOf, lifeOf, lives, log, messageAttachments, messageFrom, modelIn, nameOf, names,
    ownerFor, owners, past, principalFor, propertyOf, renameChat, restart, restartChat, restarting,
    served, sessionFor, sessionMachines, sessions, spawn, starting, statusOf, storedConfig,
    summaryMoved, value, waitingFor, wheres,
  } = ctx;

  /*
   * A worker's chat is read-only, whichever side of a restart it is on.
   *
   * Nobody types into a subagent: its conversation is the harness's work
   * inside somebody else's call. What a client may still send on one is
   * an answer to what the worker asked there and a stop, and those are
   * the lead chat's backend's to act on, since that backend runs the
   * worker. Anything else is refused here rather than falling into the
   * resume below, which would start an agent for a chat the client
   * cannot write to anyway.
   */
  const worker = toolCallOfSubagentChat(channel) !== undefined;
  if (worker && !WORKER_ACTIONS.has(type)) {
    refuse(connection.peer, channel, action, origin, `${channel} is a read-only subagent chat`);
    return;
  }
  /*
   * Which chat a client action is about.
   *
   * A chat channel names one; a session channel names the default,
   * because that is what a client talking to a session without having
   * asked for a chat means. A worker's chat names its session's lead,
   * whose backend runs the worker.
   */
  const owning = worker ? sessionFor(channel) : channel;
  const holding = sessions.get(owning);
  const held = byChat.get(channel)?.chat ?? (holding ? leadOf(holding) : undefined);
  /*
   * A session being started again waits for the start to finish.
   *
   * Moving a fixed key restarts the backend, and the first send pushes
   * the whole config and then the first turn without waiting for the
   * host between them. The turn is applied when the session it was
   * meant for is the one that exists - a backend started again is a new
   * object under the same URI - and a restart that failed answers every
   * action that waited on it with its own failure, which is the same
   * thing a refused action reads.
   *
   * Asked of the session the channel names rather than of what is
   * running, and before anything that reads "nothing is running" as a
   * session to browse: while it restarts, the session is out of
   * `sessions` and its chats out of `byChat`. The wait is returned, so
   * this connection's later dispatches go behind it in `waiting`.
   */
  const running = restarting.get(sessionFor(channel));
  if (running !== undefined) {
    return conn.bounded(running, `${channel} starting again`).then(
      () => (connections.has(connection) ? conn.applyNow(params, origin) : undefined),
      (error: unknown) => {
        refuse(connection.peer, channel, action, origin, error instanceof Error ? error.message : String(error));
      },
    );
  }
  /*
   * Config for a session with no agent yet: remembered, not refused.
   *
   * It is applied when the session is resumed, which is what makes the
   * controls on a browsed row mean something. Starting an agent here
   * instead would start one per setting somebody tried.
   */
  if (!held && type === 'session/configChanged') {
    const config = (typeof action.config === 'object' && action.config !== null
      ? action.config
      : {}) as Record<string, unknown>;
    /*
     * Only for a session this host runs, has listed, or finds in the
     * catalogue with a transcript: the store is keyed by id, and a
     * channel that names none would be a row for nothing. This host's
     * own keys decide a directory when a session is created, which a
     * browsed row was long ago, so they are not the store's.
     */
    const keep = (): void => {
      const uri = sessionFor(channel);
      const taken = Object.fromEntries(Object.entries(config).filter(([key]) => !HOSTS_OWN.includes(key)));
      if (Object.keys(taken).length > 0) kept.setConfig(idOf(uri), { ...kept.config(idOf(uri)), ...taken });
      dispatch(uri, action, origin);
    };
    const known = (): boolean => sessions.has(sessionFor(channel)) || owners.has(sessionFor(channel));
    // Before `past`, which answers nothing for a session waiting for its
    // agent and would have this one say it is not a session at all.
    const waiting = waitingFor(idOf(sessionFor(channel)));
    if (waiting !== undefined) {
      no(`${waiting} is not loaded on this host`);
      return;
    }
    if (known()) {
      keep();
      return;
    }
    // `past` reads the catalogue first, which is what lists it.
    return conn.bounded(past(idOf(sessionFor(channel))), 'reading the catalogue').then((found) => {
      if (!connections.has(connection)) return;
      if (found !== undefined || known()) keep();
      else no(`${channel} is not a session here`);
    });
  }
  /*
   * A turn on a session this host is not running yet.
   *
   * This is where browsing becomes continuing: the row was readable
   * from its transcript, and saying something is what makes it worth
   * a subprocess. Resumed rather than replayed - the agent gets the
   * context it built before, not a transcript it has been shown.
   */
  if (!held && type === 'chat/turnStarted') {
    // The session the chat belongs to, which is not the chat's own name:
    // a chat URI carries its session rather than being derived from it.
    const uri = sessionFor(channel);
    const id = idOf(uri);
    void (async () => {
      /*
       * The agent this session was recorded for, before a transcript is
       * read or a record rewritten: a host that is not serving it says
       * so by name, and the session keeps its own provider until it is
       * loaded again rather than becoming a conversation on this one.
       */
      const missing = waitingFor(id);
      if (missing !== undefined) {
        refuse(connection.peer, channel, action, origin, `${missing} is not loaded on this host`);
        return;
      }
      const seed = await past(id);
      if (!seed) {
        refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
        return;
      }
      /*
       * Named again, because `past` is what learned whose session this
       * is - and what this host will call it.
       *
       * A client may say the first thing about a row before anything has
       * listed a catalogue, and until something has, there is no name to
       * look an owner up under. Asking with the name computed beforehand
       * found nothing and refused a session that was right there.
       */
      const named = nameOf(id);
      const owner = owners.get(named);
      if (!owner) {
        refuse(connection.peer, channel, action, origin, `No backend owns ${channel}`);
        return;
      }
      // Back where it ran. A session continued in another directory is
      // a conversation whose second half cannot see the files its
      // first half was about.
      const ran = wheres.get(named)?.[0]?.replace(/^file:\/\//, '');
      /*
       * What the work is charged to: the one this session was settled
       * with, or the one this turn's sender resolves to.
       *
       * A session's charge was decided by whoever created it, possibly
       * before this process started, and it is read back rather than
       * decided again - which would answer for whoever is asking now,
       * or refuse the first turn of a session that was perfectly well
       * charged, because this daemon was started by somebody who is not
       * the person who created it. A session the store holds no charge
       * for is the one case where nobody decided it: one begun before
       * this host charged anything is settled now, from the principal
       * the turn arrived on, exactly as a new session is.
       */
      const was = kept.scope(id);
      const restored = storedConfig(owner, id);
      if (was === null) charged.set(named, undefined);
      else if (was !== undefined) charged.set(named, { scope: was });
      else charge(named, connection.principal, typeof restored.scope === 'string' ? restored.scope : undefined);
      const session = spawn(owner, named, chatUriFor(named), restored, { resume: id, seed }, ran);
      keepProvider(named, owner, session);
      log(`resumed ${named}`);
      dispatch(named, { type: 'session/ready' });
      summaryMoved(named);
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      void fire({
        type: 'message',
        session: named,
        chat: chatUriFor(named),
        turn: String(action.turnId ?? ''),
        text: String(message.text ?? ''),
      });
      const refused = await beginOrRun(session, owner.provider, String(action.turnId ?? ''), String(message.text ?? ''), modelIn(message.model), messageFrom(message), ownerFor(connection), undefined, messageAttachments(message));
      if (refused !== undefined) refuse(connection.peer, channel, action, origin, refused);
    })();
    return;
  }
  const session = held;
  /*
   * A draft in a session this host is not running.
   *
   * The one client action worth taking without starting anything: it
   * moves no conversation, costs a map entry, and starting a CLI
   * because somebody typed a character would be a session opened by
   * accident. Everything else still needs a session, and says so.
   *
   * Checked against the catalogue rather than taken on trust, the way
   * `chat/turnStarted` is - a chat URI is a client's to spell, and a
   * draft held for a session nobody has is a map that only grows.
   */
  if (!session && type === 'chat/draftChanged') {
    const id = idOf(sessionFor(channel));
    void (async () => {
      const missing = waitingFor(id);
      if (missing !== undefined) {
        refuse(connection.peer, channel, action, origin, `${missing} is not loaded on this host`);
        return;
      }
      if (!(await past(id))) {
        refuse(connection.peer, channel, action, origin, `${channel} is not a session this host knows`);
        return;
      }
      const next = typeof action.draft === 'object' && action.draft !== null
        ? action.draft as Bag
        : undefined;
      if (next === undefined) drafts.delete(channel);
      else drafts.set(channel, next);
      // Echoed, because the point of a draft being on the wire at all is
      // that the other clients watching this chat see it.
      dispatch(channel, action, origin);
    })();
    return;
  }
  if (!session) {
    // With its keys, because the useful half of this line is what was
    // in the action nobody read - a type alone says only that a client
    // wanted something.
    const carried = Object.keys(action).filter((key) => key !== 'type');
    no(`${type} names nothing here${carried.length > 0 ? ` (${carried.join(', ')})` : ''}`);
    return;
  }
  switch (type) {
    case 'chat/turnStarted': {
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      const text = String(message.text ?? '');
      const turnId = String(action.turnId ?? '');
      // Before it is started or queued, so a handler sees it once
      // whether or not the backend is free to run it this moment.
      void fire({ type: 'message', session: session.uri, chat: session.chatUri, turn: turnId, text });
      const provider = sessions.get(session.uri)?.agent.provider ?? 'This provider';
      beginTurn(
        beginOrRun(session, provider, turnId, text, modelIn(message.model), messageFrom(message), ownerFor(connection), undefined, messageAttachments(message)),
        (why) => refuse(connection.peer, channel, action, origin, why),
      );
      break;
    }
    /**
     * One key, merged.
     *
     * The action carries only what changed, so writing the whole
     * object back would revert whatever another client set while this
     * one had the form open.
     */
    /*
     * A directory added to, taken from, or put in place of the session's set.
     *
     * The SDK takes its directories when the CLI starts and exposes no
     * way to add one after, so this starts the backend again *resumed* -
     * the same conversation, in a wider place - rather than refusing.
     * Not while a turn is running: a CLI replaced mid-answer is an
     * answer that stops halfway, and `-32004` is the code for asking a
     * client to wait.
     */
    /*
     * A rename from a client.
     *
     * On a chat channel it names that chat, the way the reference host
     * reads it (`sessionTitleContribution.ts`); on the session channel
     * it names the session, which is its default chat. Blank is a
     * refusal, not a blank title: a row nobody can find again is the
     * thing the derived title exists to prevent.
     */
    case 'session/titleChanged': {
      const uri = session.uri;
      const owner = sessions.get(uri);
      if (owner === undefined) {
        no(`${channel} is not a session this host is running`);
        break;
      }
      const title = String(action.title ?? '').trim();
      if (title === '') {
        no('a title cannot be blank');
        break;
      }
      renameChat(uri, byChat.has(channel) ? channel : owner.defaultChat, title);
      break;
    }
    case 'session/workingDirectorySet':
    case 'session/workingDirectoryRemoved':
    case 'session/workingDirectoryReplaced': {
      const owner = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
      if (owner === undefined) {
        no(`${channel} is not a session this host is running`);
        break;
      }
      if (owner.agent.multipleDirectories !== true) {
        no(`${owner.agent.provider} works in one directory per session`);
        break;
      }
      const uri = session.uri;
      if ((statusOf(uri) & Status.InProgress) !== 0) {
        no('a working directory cannot change while a turn is running');
        break;
      }
      const path = (value: unknown): string => String(value ?? '').replace(/^file:\/\//, '');
      const held = owner.additional ?? [];
      let after = held;
      if (type === 'session/workingDirectorySet') {
        const one = path(action.directory);
        if (one === '' || one === owner.workingDirectory || held.includes(one)) break;
        after = [...held, one];
      }
      else if (type === 'session/workingDirectoryRemoved') {
        const one = path(action.directory);
        // The first is the process root and the protocol says a client
        // MUST NOT remove it. Said rather than silently ignored.
        if (one === owner.workingDirectory) {
          no('the first working directory is the one the agent runs in, and cannot be removed');
          break;
        }
        if (!held.includes(one)) break;
        after = held.filter((other) => other !== one);
      }
      else {
        // The primary slot, replaced atomically - which is the only way
        // index 0 may move, and why this host advertises
        // `primaryReplacement` beside `immutablePrimary`.
        const one = path(action.directory);
        if (one === '' || one === owner.workingDirectory) break;
        owner.workingDirectory = one;
      }
      owner.additional = after;
      void restart(uri, conn.tokensFor(owner.agent.provider), { additional: after })
        .then(() => { dispatch(uri, action, origin); })
        .catch((error: unknown) => { no(error instanceof Error ? error.message : String(error)); });
      break;
    }
    case 'session/configChanged': {
      const config = (typeof action.config === 'object' && action.config !== null
        ? action.config
        : {}) as Record<string, unknown>;
      // Config belongs to the session, so it is remembered there: a
      // chat opened after this one is answered starts on it too.
      const owning = holding ?? (byChat.get(channel) ? sessions.get(byChat.get(channel)?.uri ?? '') : undefined);
      /*
       * A source the session already made a machine from is that machine.
       *
       * The first send pushes the whole config bag, including the
       * `disposable:<profile>` the person picked, while the session is
       * running in the `computer://<id>` it was made into. Reading the
       * two as the same choice is what stops the fixed-key rule from
       * starting the session again with a value no backend can enter -
       * and from making a second machine while the first is alive.
       */
      const made = sessionMachines.get(session.uri);
      if (made !== undefined) {
        for (const [key, value] of Object.entries(config)) {
          if (value === made.source) config[key] = made.machine;
        }
      }
      /*
       * What each key held before this action, read before anything
       * writes over it.
       *
       * A fixed key is judged by whether it actually moved - a client
       * sends its whole config bag back on the first send - and once
       * the loop below has written the new value the old one is gone.
       * The value in effect, defaults included: a session created with
       * `{}` still runs on each default, and a client re-sending one is
       * not asking for anything.
       */
      const before = new Map<string, unknown>();
      const stored = new Map<string, unknown>();
      if (owning) {
        const effective = { ...owning.agent.defaults(), ...contributedDefaults(), ...owning.config };
        for (const key of Object.keys(config)) {
          before.set(key, effective[key]);
          stored.set(key, owning.config[key]);
        }
        // Kept as it arrived. A config value is `unknown` on the wire,
        // and `permissions` is an object - stringifying it made a
        // session remember the word `[object Object]`.
        for (const [key, value] of Object.entries(config)) owning.config[key] = value;
      }
      /*
       * A refused key put back as it was.
       *
       * The session's config is what a later chat and a restart are
       * spawned with, so a value refused here and left in it would be
       * applied anyway by the next chat opened in the session.
       */
      const undo = (key: string): void => {
        // Not over a value something else has written since.
        if (owning === undefined || owning.config[key] !== config[key]) return;
        const was = stored.get(key);
        if (was === undefined) delete owning.config[key];
        else owning.config[key] = was;
      };
      /**
       * An accepted key written to the store, which a resume after a
       * restart spawns the lead chat with.
       *
       * A key the schema scopes to one chat only when that chat is the
       * lead, since a peer chat's is that chat's and not the session's.
       * And only while the session is the one the change was made to:
       * the backend answers after a turn of the event loop, and a
       * session disposed meanwhile has had its row forgotten, maybe for
       * a new session under the same name. A session being started
       * again is still the session.
       */
      const lead = owning !== undefined && session.chatUri === owning.defaultChat;
      const life = lifeOf(session.uri);
      const remember = (key: string, value: unknown): void => {
        if (propertyOf(owning?.agent, key)?.scope === 'chat' && !lead) return;
        if (lives.get(session.uri) !== life) return;
        const id = idOf(session.uri);
        kept.setConfig(id, { ...kept.config(id), [key]: value });
      };
      /*
       * This host's own keys, which no backend has heard of.
       *
       * `isolation` and its companions decide a directory, and a
       * directory is decided when a session is created - so the answer
       * can still move while nothing has been said, and not afterwards.
       * That window is exactly the one a client puts these controls in
       * front of somebody in: it creates the backend session first so
       * the controls have somewhere to write, then sends the first
       * message. Applied together and started once, because two keys in
       * one action are one decision.
       *
       * `scope` is the one of them that decides no restart: a backend is
       * handed a folder to work in and has never heard of a charge, so
       * starting it again would throw away a conversation for a word it
       * cannot read. It is settled and refused beside the others.
       */
      const settled = decided.get(session.uri) ?? {};
      const ours = Object.entries(config)
        .filter(([key]) => HOSTS_OWN.includes(key) && key !== 'scope')
        // Only what actually differs. A client that sends its whole
        // config bag back - the same `isolation` it was given - is
        // agreeing with this host, and restarting a session to arrive
        // where it already is would be a session that disposed and
        // reopened itself for nothing.
        .filter(([key, value]) => value !== settled[key]);
      /** The same, less the key that starts nothing. */
      const rescoped = Object.entries(config)
        .filter(([key, value]) => key === 'scope' && value !== settled[key]);
      /*
       * The fixed keys a backend or a plugin declared.
       *
       * `sessionMutable: false` is the schema saying this value is read
       * when the backend starts - the computer a session runs in, and
       * Claude's thinking - so a new value before the first turn is the
       * session being created differently, exactly as `isolation` is.
       * Only a key that moved, for the same reason `ours` is filtered.
       */
      const fixed = owning === undefined ? [] : Object.entries(config)
        .filter(([key]) => !HOSTS_OWN.includes(key))
        .filter(([key]) => propertyOf(owning.agent, key)?.sessionMutable === false)
        .filter(([key, value]) => value !== before.get(key));
      /*
       * One restart for both kinds of fixed key, because two keys in
       * one action are one decision - and a restart is a backend start.
       */
      const moved = [...ours, ...fixed];
      if ((moved.length > 0 || rescoped.length > 0) && owning !== undefined) {
        /*
         * A value of the wrong shape for its key, which is a different
         * thing from a value that is fixed. The two pattern keys take a
         * list; `isolation`, the branch and the three branch rows take a
         * string, and a list sent for one of those is a mistake worth
         * saying so about.
         */
        const listOf = (key: string): boolean => key === 'worktreeIncludeFiles' || key === 'worktreeSymlinkFolders';
        const bad = [...ours, ...rescoped].find(([key, value]) => typeof value !== 'string'
          && !(listOf(key) && Array.isArray(value) && value.every((one) => typeof one === 'string')));
        const started = [...owning.chats.values()].some((chat) => chat.allTurns().length > 0);
        if (bad !== undefined) {
          for (const [key] of moved) undo(key);
          for (const [key] of rescoped) undo(key);
          no(`${bad[0]} takes ${listOf(bad[0]) ? 'a list of patterns' : 'a string'}`);
        }
        else if (started) {
          for (const [key] of moved) undo(key);
          for (const [key] of rescoped) undo(key);
          no(`${moved[0]?.[0] ?? rescoped[0]?.[0]} is fixed once the session has started`);
        }
        else {
          const mine = { ...settled };
          for (const [key, value] of [...ours, ...rescoped]) mine[key] = value;
          decided.set(session.uri, mine);
          /*
           * What the work is charged to is decided with the rest of the
           * window, so a scope that moved is resolved again here or the
           * turn would be charged to the session it was created as.
           *
           * Resolved against the session's owner and not against whoever
           * sent the change: the work belongs to the person who started
           * it, and a colleague who can see the session is not thereby
           * able to move its charge onto their own team. A root-owned
           * session names no person, so it goes to nobody - and a session
           * this host began before it recorded an owner is answered for
           * exactly as it always was. An owner this process has not seen
           * sign in cannot be checked, so the turn is refused until they do.
           *
           * What it was charged to is held, because a refusal below puts
           * it back: the action is one decision, and a decision that was
           * not taken leaves nothing of itself behind.
           */
          const wasCharged = charged.get(session.uri);
          const wasScope = kept.scope(idOf(session.uri));
          const owner = kept.owner(idOf(session.uri));
          const person = owner === undefined ? connection.principal : principalFor(owner);
          if (rescoped.length > 0) {
            if (owner?.startsWith('user:') === true && person === undefined) {
              charged.set(session.uri, { refusal: `${owner.slice('user:'.length)} has to sign in once before this session's scope can change` });
            }
            else charge(session.uri, person, typeof mine.scope === 'string' ? mine.scope : undefined);
          }
          const uri = session.uri;
          /** What the clients are told, once the decision is in force. */
          const tell = (): void => {
            for (const [key, value] of [...moved, ...rescoped]) {
              /*
               * The value the session actually has, when the restart
               * changed it. A source is made into a machine on the way
               * in, so a client told the source back would hold a value
               * the session is not running with. This host's own keys
               * are not in the backend's config, so they stay as they
               * were sent.
               */
              const answered = owning.config[key] ?? value;
              if (!HOSTS_OWN.includes(key)) remember(key, answered);
              dispatch(uri, { type: 'session/configChanged', config: { [key]: answered } }, origin);
            }
          };
          if (moved.length === 0) tell();
          else {
            /*
             * The restart, held while it runs.
             *
             * A turn can arrive in the window between the whole config
             * being pushed and the backend being ready - VS Code sends
             * both back to back - so `applyDispatch` waits on this
             * promise before it touches the session. It is cleared before
             * the promise settles to its consumers, so an action that
             * waited re-runs against the backend that is actually there.
             *
             * Whether this session may move to the machine it is being
             * moved to is asked here, where the keys are still theirs and
             * the backend is still the one it was - not inside `restart`,
             * which is past the point of undoing anything. It is the same
             * `admitted` a client's `createSession` asks, against the
             * person who owns the work and the scope it is being charged
             * to.
             *
             * A refusal undoes the whole action rather than half of it: the
             * keys, the row this host decides from, and the charge the
             * scope moved onto. Nothing is announced either - the change
             * never happened, so a `configChanged` would tell every other
             * subscriber about a setting the session does not have, and a
             * key written to the store would be what a resume starts the
             * lead chat with. The session stays exactly where it was.
             */
            const work = (async () => {
              const wrong = await admitted(person, charged.get(uri)?.scope, owning.config, owning.agent.provider, session.uri, owner);
              if (wrong !== undefined) {
                for (const [key] of moved) undo(key);
                for (const [key] of rescoped) undo(key);
                decided.set(session.uri, settled);
                if (rescoped.length > 0) {
                  if (wasCharged === undefined) charged.delete(uri);
                  else charged.set(uri, wasCharged);
                  kept.setScope(idOf(uri), wasScope);
                }
                no(wrong);
                return false;
              }
              await restart(uri, conn.tokensFor(owning.agent.provider));
              return true;
            })();
            // The promise a close waits on, which is not the work's own: a refusal is
            // answered to the client below, and a promise nobody reads must
            // not carry the rejection a second time.
            restarting.set(uri, work.then(() => undefined, () => undefined));
            const held = restarting.get(uri);
            const clear = (): void => {
              if (restarting.get(uri) === held) restarting.delete(uri);
            };
            void work.then(
              (restarted) => {
                clear();
                // Announced only where the restart happened. A refusal is
                // the action refused and nothing more.
                if (restarted) tell();
              },
              (error: unknown) => {
                clear();
                lives.delete(uri);
                no(error instanceof Error ? error.message : String(error));
              },
            );
          }
        }
      }
      for (const [key, value] of Object.entries(config)) {
        // Answered above, and not the backend's to hear about.
        if (HOSTS_OWN.includes(key)) continue;
        /*
         * What the schema says about this key, rather than what this
         * file used to know about four of them.
         *
         * `host.ts` imports no backend and is meant not to know one
         * exists, and it held the names `permissionMode`, `model`,
         * `effortLevel` and `outputStyle` and refused `thinking` by
         * name. Every one of those is a property of whatever schema the
         * backend published, and the two things this layer actually
         * needs to know are declared there: whether the key can move on
         * a running session, and whether it belongs to the session or
         * to one chat in it.
         */
        const property = propertyOf(owning?.agent, key);
        /*
         * Absent is not a refusal.
         *
         * `autoApprove` and `mode` are conventional names a client
         * sends whatever a host advertises, and this backend takes both
         * without declaring either - so the schema decides how a key
         * behaves and the backend decides whether it is taken at all.
         */
        /*
         * Immutable, and said so rather than accepted and dropped: a
         * control that reports success and changes nothing is worse
         * than one that refuses.
         *
         * Taken above when it moved before the first turn - the session
         * was started again with it - and a value that did not move is
         * not a change at all: a client re-sending the value it was
         * given is agreeing with this host rather than asking for
         * anything.
         */
        if (property?.sessionMutable === false) {
          if (fixed.some(([held]) => held === key)) continue;
          if (value === before.get(key)) continue;
          undo(key);
          no(`${key} is fixed once the session has started`);
          continue;
        }
        if (session.setConfig === undefined) {
          undo(key);
          no(`${key} is not a config key this backend takes`);
          continue;
        }
        /*
         * Every chat, or only this one, as the property says.
         *
         * A permission mode and an output style are the session's: the
         * chats are peers on one config, and a voice set on one of them
         * is a session where two conversations answer differently. A
         * model is the chat's. Neither is a fact about this host.
         */
        const everywhere = property?.scope === 'chat'
          ? []
          : (owning ? [...owning.chats.values()] : []).filter((chat) => chat !== session);
        for (const chat of everywhere) void Promise.resolve(chat.setConfig?.(key, value));
        void Promise.resolve(session.setConfig(key, value)).then((answer) => {
          // The backend's own words when it refused, because only it
          // knows whether the key or the value was the problem.
          if (answer === true) {
            remember(key, value);
            dispatch(session.uri, { type: 'session/configChanged', config: { [key]: value } }, origin);
          }
          else {
            undo(key);
            no(answer);
          }
        });
      }
      break;
    }
    /*
     * The latest turn, run again rather than typed again.
     *
     * The protocol's own conditions - latest, errored, message and parts
     * intact - are the backend's to check, because only it knows what
     * its last turn was. A backend that cannot re-run one says so here
     * rather than being asked to.
     */
    /*
     * A directory added to or taken from this chat's own set.
     *
     * The same mechanism the session's set uses - the CLI is started
     * again, resumed - applied to one chat rather than all of them. A
     * chat may only ever narrow its session's set, so anything outside
     * it is refused rather than quietly widening the session.
     */
    case 'chat/workingDirectorySet':
    case 'chat/workingDirectoryRemoved': {
      const owner = byChat.get(channel);
      if (owner === undefined) {
        no(`${channel} is not a chat this host is running`);
        break;
      }
      const held = sessions.get(owner.uri);
      if (held === undefined || held.agent.multipleDirectories !== true) {
        no('this backend works in one directory per session');
        break;
      }
      if ((statusOf(owner.uri) & Status.InProgress) !== 0) {
        no('a working directory cannot change while a turn is running');
        break;
      }
      const one = String(action.directory ?? '').replace(/^file:\/\//, '');
      const own = [held.workingDirectory, ...(held.additional ?? [])].filter((entry) => entry !== undefined);
      const had = beside.get(channel) ?? held.additional ?? [];
      let next = had;
      if (type === 'chat/workingDirectorySet') {
        if (!own.includes(one)) {
          no(`${one} is not a working directory of ${owner.uri}`);
          break;
        }
        if (one === held.workingDirectory || had.includes(one)) break;
        next = [...had, one];
      }
      else {
        if (one === held.workingDirectory) {
          no('the first working directory is the one the agent runs in, and cannot be removed');
          break;
        }
        if (!had.includes(one)) break;
        next = had.filter((other) => other !== one);
      }
      beside.set(channel, next);
      restartChat(owner.uri, channel, conn.tokensFor(held.agent.provider));
      dispatch(channel, action, origin);
      break;
    }
    case 'chat/turnResume': {
      if (session.resume === undefined) {
        no('this backend cannot run a turn again');
        break;
      }
      if (!session.resume(String(action.turnId ?? ''))) {
        no(`${String(action.turnId ?? '')} is not a turn that can be resumed`);
      }
      break;
    }
    /*
     * On a worker's chat, that worker, when the backend can stop one;
     * otherwise the lead turn that runs the worker. The action names the
     * worker's own turn, which the backend has no turn under, so the
     * worker is named by the call its chat was opened for.
     */
    case 'chat/turnCancelled': {
      if (!worker) {
        session.cancel(String(action.turnId ?? ''));
        break;
      }
      const call = toolCallOfSubagentChat(channel);
      if (session.stopWorker !== undefined && call !== undefined) {
        session.stopWorker(call);
        break;
      }
      const current = (session.chatState() as { activeTurn?: { id?: unknown } }).activeTurn;
      if (current === undefined) {
        no(`Nothing is running on ${session.chatUri} to stop`);
        break;
      }
      session.cancel(String(current.id ?? ''));
      break;
    }
    /**
     * Say it after the turn that is running.
     *
     * The queue is the host's, which is the whole difference between a
     * queue and a list: it starts the next turn from the head the
     * moment it goes idle, and every client watching the chat sees the
     * same one. Held in a client it would never be sent - nothing
     * there is watching for a turn to end.
     */
    case 'chat/pendingMessageSet': {
      const kind = String(action.kind ?? 'queued');
      const message = (typeof action.message === 'object' && action.message !== null
        ? action.message
        : {}) as Record<string, unknown>;
      /*
       * Into the running turn, rather than behind it.
       *
       * Somebody correcting an agent halfway is the most ordinary thing
       * there is, and queueing it delivered the correction after the
       * thing it was trying to stop. The two refusals left are real: a
       * backend that cannot take a message mid-turn, and a chat with
       * nothing running to steer.
       */
      if (kind === 'steering') {
        if (!session.steer) {
          no('This backend cannot take a message mid-turn');
          break;
        }
        if (!session.steer(String(action.id ?? ''), String(message.text ?? ''))) {
          no('Nothing is running in this chat to steer');
        }
        break;
      }
      if (kind !== 'queued') {
        no(`${kind} is neither a steering message nor a queued one`);
        break;
      }
      const model = (typeof message.model === 'object' && message.model !== null
        ? message.model
        : {}) as Record<string, unknown>;
      const provider = sessions.get(session.uri)?.agent.provider ?? 'This provider';
      beginTurn(
        beginOrRun(
          session,
          provider,
          crypto.randomUUID(),
          String(message.text ?? ''),
          modelIn(model),
          messageFrom(message),
          ownerFor(connection),
          String(action.id ?? ''),
        ),
        (why) => refuse(connection.peer, channel, action, origin, why),
      );
      break;
    }
    /**
     * Turn a skill or an MCP server on or off.
     *
     * `enablement` carries a decision per scope - global, workspace,
     * session - and this host has one scope, so the session's is the
     * one that matters and anything else is a decision about machines
     * it does not own.
     */
    case 'session/customizationToggled': {
      const id = String(action.id ?? '');
      const enablement = Array.isArray(action.enablement) ? action.enablement.map((entry) => (
        typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {}
      )) : [];
      const wanted = enablement.find((entry) => entry.kind === 'session') ?? enablement[0];
      const enabled = wanted?.enabled !== false;
      void session.setCustomizationEnabled(id, enabled).then((took) => {
        if (took)
          return;
        // Said, not swallowed. The customization list is what a client
        // draws the switch from, so re-reporting it puts the switch
        // back where it was rather than leaving it showing a change
        // that did not happen - and the refusal beside it is what tells
        // the one client that asked why it moved back.
        no(`${id} has no runtime switch`);
        dispatch(session.uri, { type: 'session/customizationsChanged', customizations: session.customizations() });
      });
      break;
    }
    case 'session/mcpServerStartRequested':
      void session.startMcpServer(String(action.id ?? '')).then((took) => {
        if (!took) no(`${String(action.id ?? '')} would not start`);
      });
      break;
    case 'session/mcpServerStopRequested':
      void session.stopMcpServer(String(action.id ?? '')).then((took) => {
        if (!took) no(`${String(action.id ?? '')} would not stop`);
      });
      break;
    case 'chat/draftChanged':
      // A `Message`, not a string: `ChatState.draft` is the message
      // somebody is part-way through writing, model and all. Absent
      // clears it, which is what the action says `undefined` means.
      session.setDraft(typeof action.draft === 'object' && action.draft !== null
        ? action.draft as Bag
        : undefined);
      break;
    case 'chat/pendingMessageRemoved':
      session.unqueue(String(action.id ?? ''));
      break;
    case 'chat/queuedMessagesReordered':
      session.reorder(Array.isArray(action.order)
        ? action.order.filter((id): id is string => typeof id === 'string')
        : []);
      break;
    case 'chat/toolCallConfirmed':
      session.confirm(
        String(action.toolCallId ?? ''),
        action.approved === true,
        typeof action.selectedOptionId === 'string' ? action.selectedOptionId : undefined,
      );
      break;
    case 'chat/inputCompleted': {
      /*
       * `response`, which is the field the action has.
       *
       * `ChatInputResponseKind` is `accept`, `decline` or `cancel`, and
       * this read `accepted` - a key no client sends - so every answer
       * arrived as an accept and a person declining a question was
       * indistinguishable from one answering it. `accepted` is still
       * honoured for anything that sent it before this, but `response`
       * decides when both are there.
       */
      const response = typeof action.response === 'string' ? action.response : undefined;
      const accepted = response !== undefined ? response === 'accept' : action.accepted !== false;
      session.answer(String(action.requestId ?? action.id ?? ''), accepted, (typeof action.answers === 'object' && action.answers !== null
        ? action.answers
        : {}) as Record<string, unknown>);
      break;
    }
    /*
     * Drop the turns after a named one, and mean it.
     *
     * This is edit-and-resend: a client truncates to the turn before
     * the message somebody wants to change, then starts a new turn with
     * the edited text. So the agent has to forget the dropped turns as
     * well - a host that only cleared its own screen would leave the
     * conversation carrying on from a history nobody can see any more,
     * and the next answer would be about the message that was edited
     * away.
     *
     * Forgetting them means the CLI is started again, resumed at the
     * last thing the kept turn did. The turns up to there are handed
     * over as the seed, so the chat keeps its history across the
     * restart, and the session id is kept - see `rewindAt` - so a later
     * resume reaches the truncated conversation rather than the one
     * this dropped.
     */
    case 'chat/truncated': {
      const turnId = typeof action.turnId === 'string' ? action.turnId : undefined;
      /*
       * Every turn, which this host cannot ask for.
       *
       * The action's `turnId` is optional and its absence means "clear
       * the whole conversation" - which as a rewind is a cut at a point
       * before the first prompt, and there is no such entry to name.
       * Refused rather than served as an emptied screen in front of an
       * agent that remembers all of it.
       */
      if (turnId === undefined) {
        no('This host can drop the turns after one, but not a conversation entire');
        break;
      }
      const all = session.allTurns();
      const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
      if (at < 0) {
        no(`${turnId} is not a completed turn in ${session.chatUri}`);
        break;
      }
      // The backend's own name for the end of that turn. Absent for a
      // turn this process did not watch run - one read back off a
      // transcript - and a rewind to a point the backend cannot be told
      // is the half of this that would silently not happen.
      const point = session.endPoint?.(turnId);
      const started = session.agentId();
      const owner = sessions.get(session.uri);
      if (point === undefined || started === undefined || owner === undefined) {
        no(`${turnId} is not a turn this host can rewind to`);
        break;
      }
      /*
       * Said before the restart, not after.
       *
       * A client applies this by dropping the turns after `turnId`; the
       * session that comes up behind it opens with exactly those turns.
       * In the other order a client would take a full snapshot and then
       * be told to cut it, which is the same end state reached by
       * showing somebody the turns they asked to be rid of.
       */
      dispatch(session.chatUri, action);
      session.close();
      // So the next thing the new session says about itself is reported
      // rather than compared against what the old one last said.
      ctx.described.delete(session.chatUri);
      spawn(
        owner.agent,
        session.uri,
        session.chatUri,
        owner.config,
        { resume: started, rewindAt: point, seed: all.slice(0, at + 1) as Bag[] },
        owner.workingDirectory,
        undefined,
        beside.get(session.chatUri) ?? owner.additional,
      );
      log(`truncated ${session.chatUri} to ${turnId}`);
      break;
    }
    /*
     * Somebody's half-typed answer, kept for whoever else is looking.
     *
     * The same argument as `chat/draftChanged`: two people on one chat
     * are answering one question, and an answer each client kept to
     * itself would need no host at all. What it is kept *on* is the
     * request this host is already holding open - the protocol calls
     * the result the request's synced answer state, and says a
     * `chat/inputCompleted` may carry no answers because this is where
     * they are.
     */
    case 'chat/inputAnswerChanged': {
      if (!session.setAnswer) {
        no('This backend keeps no draft answers');
        break;
      }
      const requestId = String(action.requestId ?? '');
      const questionId = String(action.questionId ?? '');
      // Absent clears that question's draft, which is what the action
      // says `undefined` means and the only way JSON can say it.
      const answer = typeof action.answer === 'object' && action.answer !== null
        ? action.answer as Bag
        : undefined;
      if (!session.setAnswer(requestId, questionId, answer))
        no(`${requestId} is not a question this chat is waiting on`);
      break;
    }
    /*
     * Approving a tool call's *result*, which nothing here ever asks for.
     *
     * It belongs to a call completed with `requiresResultConfirmation`,
     * and no call this host builds sets it - the confirmation asked for
     * here is before the tool runs, not after. A client sending one is
     * answering a question nobody put.
     */
    case 'chat/toolCallResultConfirmed':
      no('No tool call here asks for its result to be confirmed');
      break;
    /*
     * What a client's own tool did, said by the client that ran it.
     *
     * The protocol makes the client named in the call's contributor
     * responsible for executing it and dispatching the result, so this
     * is the other half of offering a client's tools to the model at
     * all: the agent is blocked on this call, and this is what unblocks
     * it.
     *
     * Nothing is echoed from here. The result goes back to the harness,
     * the harness writes the tool result, and the session reports the
     * completion to every client from that - the same path every other
     * tool call takes. Relaying it here as well would draw the row
     * finished twice, once from a client's word and once from what
     * actually happened.
     */
    case 'chat/toolCallComplete': {
      const toolCallId = String(action.toolCallId ?? '');
      const clientId = connection.clientId || 'anonymous';
      const result = (typeof action.result === 'object' && action.result !== null
        ? action.result
        : {}) as Bag;
      if (!session.completeToolCall) {
        no('This backend runs no tools on a client\'s behalf');
        break;
      }
      // `ToolCallResult.content` is MCP's content blocks; what reaches a
      // model through this host is text, so text is what is read out of
      // them. An error carries its message instead, which is the only
      // thing a failed call actually says.
      const ok = result.success !== false;
      const text = (Array.isArray(result.content) ? result.content : [])
        .map((block) => (typeof block === 'object' && block !== null ? block as Bag : {}))
        .filter((block) => typeof block.text === 'string')
        .map((block) => String(block.text))
        .join('\n');
      const wrong = typeof result.error === 'object' && result.error !== null
        ? String((result.error as Bag).message ?? '')
        : '';
      if (!session.completeToolCall(toolCallId, clientId, {
        text: ok ? text : (wrong || text || 'The tool failed'),
        ok,
      })) no(`${toolCallId} is not a call ${clientId} is running here`);
      break;
    }
    /*
     * Streaming into a call while it runs, which is a *contributor's* to
     * do.
     *
     * The protocol has the owning client dispatch this for a tool the
     * client itself provides - the call carries a `ToolCallContributor`
     * with that client's id, and a server should refuse anyone else.
     * Relayed rather than reduced: what a tool is printing as it runs is
     * the running client's to say, and this host holds none of it.
     */
    case 'chat/toolCallContentChanged': {
      const toolCallId = String(action.toolCallId ?? '');
      const clientId = connection.clientId || 'anonymous';
      const owner = session.toolCallOwner?.(toolCallId);
      if (owner === undefined) {
        no(`${toolCallId} is not a call a client is running here`);
        break;
      }
      if (owner !== clientId) {
        no(`${toolCallId} is ${owner}'s call, and its content is ${owner}'s to change`);
        break;
      }
      dispatch(session.chatUri, action);
      break;
    }
    default:
      no(`${type} is not served yet`);
  }
}
