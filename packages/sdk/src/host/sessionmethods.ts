import { INTERNAL_ERROR, RpcError } from '../rpc.js';
import { idOf } from '../catalog.js';
import { tail, older } from '../paging.js';
import { namesOf } from '../scopes.js';
import { localPath, uriOf } from '../fileuri.js';
import { CLOSING } from './common.js';
import { chatIdFor, named, ROOT } from './channels.js';
import { SEEDS } from './sessionconfig.js';
import type { Bag } from '../types/common.js';
import type { Claimed, Held } from './state.js';
import type { ConnectionContext, HostContext } from './context.js';

/**
 * The sessions and chats a connection reads and writes.
 *
 * The snapshot and the turns, the catalogue, the four commands that start and
 * stop a session or a chat, and the two that answer a config before one
 * exists.
 */
export interface SessionMethods {
  subscribe: (params: Record<string, unknown>) => Promise<unknown>;
  fetchTurns: (params: Record<string, unknown>) => Promise<unknown>;
  completions: (params: Record<string, unknown>) => Promise<unknown>;
  listSessions: (params: Record<string, unknown>) => Promise<unknown>;
  createSession: (params: Record<string, unknown>) => Promise<unknown>;
  createChat: (params: Record<string, unknown>) => Promise<unknown>;
  disposeChat: (params: Record<string, unknown>) => Promise<unknown>;
  disposeSession: (params: Record<string, unknown>) => Promise<unknown>;
  resolveSessionConfig: (params: Record<string, unknown>) => Promise<unknown>;
  sessionConfigCompletions: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createSessionMethods(ctx: HostContext, conn: ConnectionContext): SessionMethods {
  const { connection } = conn;
  const {
    about, admitted, agents, answeredAs, backendsOwn, beginOrRun, beside, byChat, charged, chatOf,
    chatSummary, claimable, claims, dir, dispatch, drafts, dropChat, first, flushDeltas, forWhom, heldAs,
    isolating, isolated, keepChat, kept, leadOf, allRows, log, madeFrom, meantBy, messageFrom, openSession, options,
    ownerFor, past, placedIn, presence, replayable, removeSession, retool, scoping, seeded,
    seenBy, sessionChannel, sessionFor, sessionOfChat, sessionSchema, sessions, settle, snapshotOf,
    spawn, unheld, waitingFor, watches, withSender,
  } = ctx;

  /**
   * The most rows this host will serve in one page, however many were asked for.
   *
   * The protocol says a server MAY impose its own cap, and one exists so that a
   * client asking for a million does not turn a page into the whole catalogue
   * plus the work of slicing it.
   */
  const PAGE_CAP = 500;

  /**
   * The most rows a client that asked for no page size is handed at once.
   *
   * Deliberately far above any real catalogue rather than at a page's size:
   * neither client that connects to this host reads `nextCursor`, so anything
   * smaller would be a catalogue silently cut down to it. This is not a page
   * size - it is the point past which a single frame stops being servable at
   * all, and reaching it is written to the log because the client cannot see it.
   */
  const PAGE_MOST = 1_000;

  /**
   * A pagination cursor, which is opaque by contract.
   *
   * It is the resource of the last row served, encoded - so it says nothing a
   * client is invited to read, parse or keep. The protocol says cursors are
   * server-defined and MUST be treated as opaque; encoding is what makes that
   * true rather than merely asked for.
   */
  const sealed = (resource: string): string => Buffer.from(resource, 'utf8').toString('base64url');

  /** The resource a cursor named, or nothing a row will match. */
  const opened = (cursor: string): string => {
    try { return Buffer.from(cursor, 'base64url').toString('utf8'); }
    catch { return ''; }
  };

  return {
    /**
     * A snapshot, and everything that happened while it was being taken.
     *
     * `snapshotOf` is asynchronous, and until it returns this connection
     * is not on the watch list - so an action dispatched in that window
     * goes to nobody, and is in no snapshot taken before it happened. It
     * is a small window and it is wide enough: a client that subscribes
     * and sends in the same breath - which is what opening a session from
     * a composer *is* - loses the `chat/turnStarted` its own message
     * caused. What follows is worse than one missing action, because
     * every delta after it names a turn the client was never told about
     * and the reducer drops each one in turn: the transcript stays empty
     * for the rest of the session, and nothing anywhere reports an error.
     *
     * Replayed from the buffer rather than closed by joining the watch
     * list first, because that order has a hole of its own - the client
     * would be sent actions the snapshot already contains, and a
     * `chat/delta` applied twice is the word written twice. The sequence
     * number is what tells "already in the snapshot" from "after it", and
     * this host keeps one for exactly this reason.
     */
    /**
     * Watch a channel, and answer with what it holds now.
     *
     * Subscribing twice to one channel answers twice. Nothing here marks a
     * subscription pending while its snapshot is taken, so a second
     * request that arrives during the first is an ordinary second request
     * rather than a replacement - the reference host cancels the earlier
     * one and answers it `-32001` naming a channel it is actively serving,
     * which reads like a session that does not exist.
     */
    subscribe: async (params) => {
      const channel = String(params.channel ?? '');
      /*
       * Text still in the window goes out before the snapshot is read.
       *
       * A snapshot of a chat is built from the parts the backend is writing
       * into, so it already carries the words a held delta would say. Sent
       * after it, that delta writes them a second time - and the sequence
       * number is exactly what says so: flushed first, the delta is at or
       * below the number the snapshot is taken at, and no client is replayed
       * a word it was handed.
       */
      flushDeltas();
      // What it means here, and what it was called there. The snapshot is
      // taken of the channel and returned under the name the client used -
      // a client that asked about one URI and was answered about another
      // has been answered about something it is not watching.
      const snapshot = await snapshotOf(meantBy(channel), connection.config ?? {}, connection);
      /*
       * Resolved again, after the snapshot rather than before it.
       *
       * Opening a browsed row is what makes this host ask its backend for
       * a catalogue, and until it has asked there is no name for the row
       * to be an alias *of* - so a name resolved beforehand came back
       * unchanged, no alias was recorded, and every action about that
       * session afterwards went out under a name this client was not
       * watching.
       */
      const meant = answeredAs(connection, channel, snapshot);
      connection.watching.add(channel);
      // From here on, an unsubscribe means something: a watch nobody has
      // subscribed to yet is not one everybody has finished with.
      const held = watches.get(channel);
      if (held) held.opened = true;
      // Nothing is awaited between the line above and this one, so
      // nothing can be dispatched in between: what the filter finds is
      // the whole of what was missed, and what it leaves is already in
      // the snapshot or still to come by the ordinary route.
      const at = typeof snapshot.fromSeq === 'number' ? snapshot.fromSeq : 0;
      for (const held of replayable) {
        if (held.channel === meant && held.serverSeq > at) {
          const envelope = seenBy(connection, held);
          connection.peer.notify('action', meant === channel
            ? envelope
            : { ...envelope, channel });
        }
      }
      return { snapshot };
    },
    /**
     * Older turns, on demand.
     *
     * The result is deliberately empty: the turns arrive as
     * `chat/turnsLoaded` on the channel, so every client watching the chat
     * gets the page - not only the one that asked for it. A host that
     * answered in the result would be telling one client something the
     * others would never learn.
     */
    fetchTurns: async (params) => {
      // Under whatever spelling the client used: a chat may be addressed
      // by a URI this host did not mint, and a page of turns asked for
      // under that name is the same chat.
      const channel = meantBy(String(params.channel ?? ''));
      /*
       * A chat's or a session's, and never another kind of name that carries
       * an id.
       *
       * The transcript a page is read from is chosen by the id inside the
       * channel, so a terminal, a file or a watch called after a session's id
       * would be answered with that session's turns - sent, as `turnsLoaded`
       * is, to everyone watching *that* name. Never a session's id read out
       * of a file, a terminal or a watch, which is the guard `snapshotOf`
       * makes and this is the same one.
       */
      if (!sessionChannel(sessionOfChat(channel) ?? channel))
        throw new RpcError(-32602, `${channel} is not a session or a chat`);
      const live = byChat.get(channel);
      // Asked before the transcript, so a page asked for out of a session
      // waiting for its agent names that agent rather than saying the
      // session is nowhere.
      const missing = waitingFor(idOf(sessionFor(channel)));
      if (missing !== undefined) throw new RpcError(-32002, `${missing} is not loaded on this host`);
      const all = live ? live.chat.allTurns() : await past(idOf(sessionFor(channel)));
      if (!all)
        throw new RpcError(-32001, `No agent for session ${channel}`);
      const asked = typeof params.cursor === 'string' ? params.cursor : undefined;
      // No cursor means "load whatever is next", which is the page before
      // the one the snapshot carried.
      const from = asked ?? tail(all).turnsNextCursor;
      if (from === undefined) {
        // A session whose state holds every retained turn has no older
        // page and no cursor to carry. The protocol asks for that page
        // "if any", so there being none is an answer and not a refusal.
        return {};
      }
      const page = older(all, from);
      if (!page) {
        // An omitted cursor can only fail here on a transcript that moved
        // under the read, which is still an answer of "nothing older".
        if (asked === undefined) return {};
        // Guessing at a cursor this host did not issue would answer a
        // question about old turns with new ones, and the client would
        // page for ever without noticing.
        throw new RpcError(-32602, `Unrecognised cursor ${String(asked)}`);
      }
      dispatch(channel, {
        type: 'chat/turnsLoaded',
        // The action declares no `_meta` of its own, so the turns are the
        // whole of it: a client paging back through a conversation must not
        // find the sender gone on the oldest page.
        turns: withSender(idOf(sessionFor(channel)), page.turns),
        ...(page.turnsNextCursor ? { turnsNextCursor: page.turnsNextCursor } : {}),
      });
      return {};
    },
    /**
     * Completions for the text a person is composing.
     *
     * Answers `/` with the commands available to the session, or the
     * harness-wide list when it has none yet. `@` means a file and is not
     * served, so it returns nothing.
     */
    completions: async (params) => {
      if (String(params.kind ?? '') !== 'userMessage')
        return { items: [] };
      const text = String(params.text ?? '');
      const offset = typeof params.offset === 'number'
        ? Math.max(0, Math.min(params.offset, text.length))
        : text.length;
      const before = text.slice(0, offset);
      /*
       * An at-sign at the start of a word, and a path since.
       *
       * Answered before the slash, because the two cannot both match and
       * a file is the more specific question. What follows may contain
       * slashes - `@src/ho` is a path being typed, not a command - so the
       * pattern stops at whitespace rather than at a separator.
       */
      const asked = /(?:^|\s)@(\S*)$/.exec(before);
      if (asked) {
        const typed_ = asked[1] ?? '';
        const from = offset - typed_.length - 1;
        const asking = meantBy(String(params.channel ?? ''));
        const chat_ = byChat.get(asking)?.chat
          ?? (sessions.get(asking) ? leadOf(sessions.get(asking) as Held) : undefined);
        // Relative to the session's own directory, which is what a person
        // means by a path while talking to an agent working there.
        const base = localPath(chat_?.workingDirectories()[0] ?? dir);
        // Nothing rather than an error: this same command serves `/`,
        // and a host with no filesystem still has commands to offer.
        if (!options.resources) return { items: [] };
        const paths = await options.resources.complete(typed_, base);
        return {
          items: paths.map((path) => ({
            insertText: `@${path}`,
            rangeStart: from,
            rangeEnd: offset,
            attachment: {
              // A reference, not the bytes: the file is fetched with
              // `resourceRead` if anything needs it, and a completion that
              // carried a megabyte would carry it per keystroke.
              type: 'resource',
              uri: uriOf(`${base}/${path}`.replace(/\/{2,}/g, '/')),
              label: path,
            },
          })),
        };
      }
      // A slash at the start of a word, and nothing but word characters
      // since. A slash mid-sentence is a path, not a command.
      const found = /(?:^|\s)\/([\w:-]*)$/.exec(before);
      if (!found)
        return { items: [] };
      const typed = (found[1] ?? '').toLowerCase();
      const start = offset - typed.length - 1;
      const asked_ = meantBy(String(params.channel ?? ''));
      /*
       * The session behind the channel, and the backend it runs.
       *
       * Both kinds of channel are read, because a chat carries its session's
       * URI and a session channel is the session itself. The backend is what
       * the fallback list below belongs to.
       */
      const chat = byChat.get(asked_);
      const held = chat === undefined ? sessions.get(asked_) : sessions.get(chat.uri);
      const session = chat?.chat ?? (held === undefined ? undefined : leadOf(held));
      // A live session's own list wins: two sessions in one directory can
      // be handed different things.
      /*
       * Inside the containers, because that is where a leaf lives.
       *
       * A top-level customization is a plugin or a directory and a skill
       * or a prompt is one of its `children` - so a filter that looked
       * only at the top level found nothing, every time, and this fell
       * back to the backend-wide list on every keystroke. Which answered
       * correctly and by accident: the whole point of `own` is that two
       * sessions in one directory can be handed different things.
       */
      const leaves = (session?.customizations() ?? []).flatMap((entry) => {
        const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
        return children.length > 0 ? children : [entry];
      });
      /*
       * A leaf's argument hint, wherever its kind keeps one.
       *
       * `PromptCustomization` declares `argumentHint` and `SkillCustomization`
       * does not, so a skill's travels as `_meta['ahpd.argumentHint']`.
       */
      const hintOf = (entry: Bag): string | undefined => {
        if (typeof entry.argumentHint === 'string') return entry.argumentHint;
        const hint = (entry._meta as Bag | undefined)?.['ahpd.argumentHint'];
        return typeof hint === 'string' ? hint : undefined;
      };
      const own = leaves
        // Skills as well as prompts, and not the ones the CLI keeps for
        // the agent: offering one it will refuse is worse than not
        // offering it.
        .filter((entry) => (entry.type === 'prompt' || entry.type === 'skill')
          && entry.disableUserInvocation !== true)
        .map((entry) => ({
        name: String(entry.name),
        description: typeof entry.description === 'string' ? entry.description : undefined,
        argumentHint: hintOf(entry),
        isSkill: entry.type === 'skill',
      }));
      /*
       * Which of the backend-wide commands are skills.
       *
       * The probe's flat command list cannot say - the CLI reports a
       * skill behind a slash as a command like any other - but its
       * customizations can, and a skill is a leaf of one of them. Read
       * once per answer rather than per item.
       */
      const skillsOf = (provider: string): Set<string> => {
        const out = new Set<string>();
        for (const entry of about(provider).seeds) {
          const children = Array.isArray(entry.children) ? entry.children as Bag[] : [];
          for (const leaf of children.length > 0 ? children : [entry]) {
            if (leaf.type === 'skill' && typeof leaf.name === 'string') out.add(leaf.name);
          }
        }
        return out;
      };
      const skilled = (provider: string) => {
        const skills = skillsOf(provider);
        return about(provider).commands.map((command) => ({ ...command, isSkill: skills.has(command.name) }));
      };
      /*
       * ...but an empty list means *not known yet*, not *none*.
       *
       * A session created a moment ago has not heard back from its
       * backend, and preferring its silence over the backend-wide list is
       * a slash menu that is empty for exactly as long as somebody is
       * likely to use it.
       *
       * The fallback list is the client's own `provider`, when it names
       * one, because it is composing for that backend and this is the only
       * thing that knows.
       * Otherwise the session's own - a session whose CLI has not answered yet
       * is handed its backend's commands rather than every backend's, which is
       * a menu full of items that session would refuse. With no session and no
       * provider it is the root channel being asked, and the answer is every
       * backend's.
       */
      const named = String(params.provider ?? '');
      const mine = held?.agent.provider;
      const one = named !== '' && agents.has(named) ? named : mine;
      const wide = one !== undefined && agents.has(one)
        ? skilled(one)
        : [...agents.keys()].flatMap((provider) => skilled(provider));
      /*
       * One item per name, because two backends can offer one command.
       *
       * Five Claude presets report the same `batch`, so the every-backend
       * answer above carries one copy per preset - a menu where `/batch` is
       * drawn five times and picking the second is picking the first. The
       * first is kept: the backends are read in registration order, so which
       * of two commands with one name is offered does not move between
       * keystrokes.
       */
      const seen = new Set<string>();
      const offered = (own.length > 0 ? own : wide).filter((command) => {
        if (seen.has(command.name)) return false;
        seen.add(command.name);
        return true;
      });
      const matches = offered
        .filter((command) => command.name.toLowerCase().includes(typed))
        // What was typed a prefix of, first. A substring match is useful
        // and is not what somebody typing `de` is looking for.
        .sort((a, b) => {
        const rank = Number(b.name.toLowerCase().startsWith(typed))
          - Number(a.name.toLowerCase().startsWith(typed));
        return rank !== 0 ? rank : a.name.localeCompare(b.name);
      })
        /*
         * A menu's worth when something was typed; the list when nothing
         * was.
         *
         * A bare slash is a client asking what there is, and it may well
         * filter the answer itself rather than ask again per keystroke -
         * so truncating that to a screenful drops commands it would then
         * never offer, silently and always the same ones. A narrowing
         * query is the interactive case and stays bounded.
         */
        .slice(0, typed === '' ? 500 : 50);
      return {
        items: matches.map((command) => ({
          // The space only when it takes an argument: a trailing space on
          // a command that takes none is a character somebody deletes.
          insertText: command.argumentHint ? `/${command.name} ` : `/${command.name}`,
          rangeStart: start,
          rangeEnd: offset,
          attachment: {
            type: 'simple',
            label: `/${command.name}`,
            ...(command.description ? { modelRepresentation: command.description } : {}),
            /*
             * What makes it a *command* rather than a line of text.
             *
             * The protocol declares `SimpleMessageAttachment` with a label
             * and no notion of a slash command, so the reference client
             * reads one out of `_meta`: a bag carrying `command` is a
             * slash command, one carrying `uri` is a skill, and a bag
             * carrying neither is dropped without a word. That is the
             * whole reason a menu can come back full and draw empty -
             * every item was answered and none was a command.
             *
             * `description` is the second column and `argumentHint` is
             * the ghost text after an accepted one.
             */
            _meta: {
              command: command.name,
              // A skill, said so: the reference client keeps a runtime
              // skill in an automation's text only when the flag is
              // there, and drops it as a command it cannot find a file
              // for otherwise. `true` or absent, the way it is read.
              ...(command.isSkill ? { isSkill: true } : {}),
              ...(command.description ? { description: command.description } : {}),
              ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
            },
          },
        })),
      };
    },
    /**
     * The catalogue, in pages when a client asks for one.
     *
     * Only when it asks. `limit` omitted is the protocol's own "let the
     * server choose the page size", and the size this host chooses is all
     * of them - because neither client that connects to it reads
     * `nextCursor`: VS Code's `listSessions` sends `{ channel }` and takes
     * `items`, and so does ahpc. A default page would silently be the
     * whole catalogue to both of them.
     */
    listSessions: async (params) => {
      /*
       * The running sessions built now and the held rows behind them.
       *
       * Neither half waits for the other: a live row is read out of memory and
       * is never stale, and the listed ones are whatever the last refresh
       * found. So a client is answered in the time it takes to sort, however
       * long a pass over the machine's transcripts takes.
       */
      const rows = await allRows();
      /*
       * And a refresh behind that answer.
       *
       * The catalogue is held rather than listed per question, so what brings
       * it up to date is somebody's job. `refresh` shares a listing that is
       * already running and says what moved to every client, so a client that
       * asks again while this is in flight is answered from the rows it has
       * and told about the rest rather than waiting for the same pass twice.
       */
      void ctx.refresh().catch(() => {});
      const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
      const after = cursor === undefined
        ? 0
        : rows.findIndex((row) => row.resource === opened(cursor)) + 1;
      // Refused rather than guessed at, the way an unrecognised turn
      // cursor is: a cursor whose row has been disposed would otherwise
      // resume from the top, and the client would page for ever.
      if (cursor !== undefined && after === 0)
        throw new RpcError(-32602, `Unrecognised cursor ${cursor}`);
      const limit = typeof params.limit === 'number' && Number.isFinite(params.limit)
        ? Math.max(1, Math.min(Math.floor(params.limit), PAGE_CAP))
        : PAGE_MOST;
      const items = rows.slice(after, after + limit);
      // Said out loud, because it is the one case a client cannot see: a
      // catalogue past the bound is one this host can no longer hand over
      // whole, and neither client that connects to it reads `nextCursor`.
      if (limit === PAGE_MOST && rows.length - after > PAGE_MOST) {
        log(`${String(rows.length)} sessions is past ${String(PAGE_MOST)}: paging, which no client here asks for`);
      }
      const last = items[items.length - 1];
      return {
        items,
        ...(last && after + items.length < rows.length ? { nextCursor: sealed(last.resource) } : {}),
      };
    },
    /**
     * Start one.
     *
     * The **client** chooses the URI and sends it as `channel` - which is
     * what makes the session addressable before this host has answered, so
     * the client can subscribe to it without a round trip in between.
     *
     * Held as `<provider>:/<id>`, with the id from the client's URI, which
     * is the name a listed session has and the one VS Code routes on. The
     * client's own URI stays a name for it: `heldAs` resolves it and a
     * connection subscribed under it is answered in its spelling -
     * decision `a-session-is-held-under-its-providers-name`.
     */
    createSession: async (params) => {
      if (ctx.closed) throw new RpcError(INTERNAL_ERROR, CLOSING);
      const given = named(String(params.channel ?? ''), 'session');
      const provider = String(params.provider ?? first.provider);
      const uri = `${provider}:/${idOf(given)}`;
      unheld(uri, given);
      /*
       * Both names, claimed before anything is made for the session, so a
       * second creation of either while this one waits on a worktree or
       * a machine is refused; let go again unless the session was made.
       */
      const pending: Claimed = { kind: 'session', of: uri };
      for (const one of new Set([uri, given])) claims.set(one, pending);
      const release = (): void => {
        for (const one of [uri, given]) if (claims.get(one) === pending) claims.delete(one);
      };
      try {
        const config = (typeof params.config === 'object' && params.config !== null
          ? params.config
          : {}) as Record<string, string>;
        /*
         * Where the client asked the agent to work.
         *
         * A list on the wire and one directory to a session, so the first is
         * the answer. `file://` comes off: everything below here deals in
         * paths, and a backend handed a URI would open a directory called
         * `file:`.
         */
        const wanted = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => localPath(entry));
        const asked = wanted[0];
        const where = asked;
        // The peers of the first, which the protocol says are equal to each
        // other and to it in everything but which one the process is rooted
        // at. A backend that cannot take them is told none.
        const peers = agents.get(provider)?.multipleDirectories === true ? wanted.slice(1) : [];
        /*
         * The worktree, before anything is started in it.
         *
         * Made first because the backend is handed a directory and expected
         * to work in it: a session opened in the folder and then moved would
         * be an agent whose files changed under it. A failure here is a
         * session that never existed, which is the right outcome - the
         * alternative is one running somewhere the person did not choose.
         */
        /*
         * How far along, for the one thing here that takes visible time.
         *
         * `root/progress` echoes the `progressToken` the request carried, so
         * it is sent only when the client asked for one - and only to the
         * client that asked, because the token is that request's and means
         * nothing to anybody else. Making a worktree is `git worktree add`
         * plus a copy of whatever the client asked to bring along, which on
         * a large repository is seconds a person otherwise waits through
         * with nothing on screen.
         */
        const token = typeof params.progressToken === 'string' ? params.progressToken : undefined;
        const along = (progress: number, message: string): void => {
          if (token === undefined) return;
          connection.peer.notify('root/progress', { channel: ROOT, progressToken: token, progress, total: 2, message });
        };
        along(0, config.isolation === 'worktree' ? 'Making a working tree' : 'Starting the session');
        const running = await isolated(uri, config, where);
        along(1, 'Starting the agent');
        await settle(uri, where, config, connection.principal);
        /*
         * Checked before the machine is made, so a refused session makes
         * none, against the computer the client asked for and the scope the
         * session is charged to.
         */
        const refused = await admitted(connection.principal, charged.get(uri)?.scope, config, provider, uri, ownerFor(connection));
        if (refused !== undefined) throw new RpcError(-32009, refused);
        // A `disposable:<profile>` setting is a machine made for this
        // session, with this harness's needs and this folder, before the
        // backend is started with it.
        await placedIn(uri, provider, config, running, ownerFor(connection));
        // This connection's tokens and no other's. A client that pushed
        // nothing gets a session on the daemon's own credentials, which is
        // how every session worked before there was anything to push.
        // Handed over, since `openSession` refuses a name this still holds.
        release();
        // Whose this is: this connection's person, kept beside the session
        // so a scope change before the first turn is resolved against who
        // owns the work rather than against whoever sent it.
        openSession(uri, provider, backendsOwn(config), running, undefined, conn.tokensFor(provider), peers, undefined,
          { ...forWhom(ownerFor(connection), connection.principal), sender: connection });
        if (!claims.has(given)) claims.set(given, { kind: 'session', of: uri });
        // Complete, which the protocol spells as `progress === total`.
        along(2, 'Ready');
        /*
         * The creator claiming its place in the session it just made.
         *
         * The protocol's own words: "equivalent to dispatching a
         * `session/activeClientSet` immediately after creation". Answered
         * here rather than left to that dispatch because it saves the round
         * trip the field exists to save, and because a client that has to
         * announce itself afterwards owns a session that is briefly empty
         * of it.
         *
         * The `clientId` is this connection's, not the one in the payload.
         * The protocol says the two MUST match, and forcing it is what the
         * dispatch path does for the same reason: a client naming somebody
         * else is announcing a presence that is not theirs.
         */
        const claimed = typeof params.activeClient === 'object' && params.activeClient !== null
          ? params.activeClient as Bag
          : undefined;
        if (claimed !== undefined) {
          const clientId = connection.clientId || 'anonymous';
          const activeClient: Bag = {
            ...claimed,
            clientId,
            tools: Array.isArray(claimed.tools) ? claimed.tools : [],
          };
          const here = presence.get(idOf(uri)) ?? new Map<string, Bag>();
          presence.set(idOf(uri), here);
          here.set(clientId, activeClient);
          dispatch(uri, { type: 'session/activeClientSet', activeClient });
          retool(uri);
        }
        return null;
      }
      finally { release(); }
    },
    /**
     * A second conversation in one session.
     *
     * Same backend, same directory, same config - which is what makes the
     * chats peers rather than one being the other's child. `source` is
     * accepted: a `fork` resumes at the turn and seeds the copy from the
     * source transcript, and a `sideChat` copies nothing and carries that
     * turn's text on its first prompt.
     */
    createChat: async (params) => {
      const uri = heldAs(String(params.channel ?? ''));
      const chatUri = String(params.chat ?? '');
      const held = sessions.get(uri);
      if (!held)
        throw new RpcError(-32001, `No agent for session ${uri}`);
      if (idOf(chatUri) === '' || chatUri.indexOf(':') <= 0)
        throw new RpcError(-32602, `${chatUri} is not a chat URI`);
      if (byChat.has(chatUri))
        throw new RpcError(-32003, `${chatUri} already exists`);
      claimable(chatUri, 'chat');
      /*
       * Made out of another chat, when a client asks for that.
       *
       * A fork copies the conversation through one turn and continues it,
       * under an id of its own so the chat it came from is untouched. A
       * side chat copies nothing and is *told* what that turn said - the
       * protocol is explicit that the source transcript stays out of its
       * visible history, so the context rides on its first prompt.
       */
      const source = (typeof params.source === 'object' && params.source !== null
        ? params.source
        : undefined) as { kind?: unknown; chat?: unknown; turnId?: unknown } | undefined;
      let made: { resume?: string; seed?: Bag[]; forkAt?: string; context?: string } | undefined;
      let origin: Bag | undefined;
      if (source !== undefined) {
        const kind = String(source.kind ?? '');
        // The kind first, because it decides whether the rest of the
        // source means anything: an unknown one is a client asking for
        // something this host has never heard of, and saying "no such
        // turn" about it would send somebody looking at the turn.
        if (kind !== 'fork' && kind !== 'sideChat')
          throw new RpcError(-32602, `${kind} is not a chat source this host knows`);
        const from = byChat.get(chatOf(String(source.chat ?? '')));
        if (!from || from.uri !== uri)
          throw new RpcError(-32602, `${String(source.chat ?? '')} is not a chat in ${uri}`);
        const turnId = String(source.turnId ?? '');
        const all = from.chat.allTurns();
        const at = all.findIndex((one) => String((one as Bag).id ?? '') === turnId);
        if (at < 0)
          throw new RpcError(-32602, `${turnId} is not a turn in ${String(source.chat ?? '')}`);
        if (kind === 'fork') {
          if (held.agent.chats?.fork !== true)
            throw new RpcError(-32602, `${held.agent.provider} cannot fork a chat from a turn`);
          // The backend's own name for where that turn ended, which is
          // the only one it can be asked to continue from.
          const point = from.chat.forkPoint?.(turnId);
          const started = from.chat.agentId();
          if (point === undefined || started === undefined)
            throw new RpcError(-32602, `${turnId} is not a turn this host can fork from`);
          made = { resume: started, forkAt: point, seed: all.slice(0, at + 1) as Bag[] };
        }
        else {
          if (held.agent.chats?.sideChat !== true)
            throw new RpcError(-32602, `${held.agent.provider} cannot start a side chat from a turn`);
          const message = (all[at] as Bag | undefined)?.message;
          const said = typeof message === 'object' && message !== null
            ? (message as { text?: unknown }).text
            : undefined;
          made = { context: typeof said === 'string' ? said : '' };
        }
        /*
         * What the new chat says it was made from, kept for as long as it
         * is: the summary is re-sent whole on every change, so an origin
         * given only on `session/chatAdded` would be said once and then
         * overwritten with `user`. A selection is kept as the protocol
         * declares it, and only when it has text.
         */
        const picked = (source as { selection?: unknown }).selection as { text?: unknown; responsePartId?: unknown } | undefined;
        const selection = kind === 'sideChat' && typeof picked === 'object' && picked !== null
          && typeof picked.text === 'string' && picked.text !== ''
          ? { text: picked.text, ...(typeof picked.responsePartId === 'string' ? { responsePartId: picked.responsePartId } : {}) }
          : undefined;
        origin = { kind, chat: chatOf(String(source.chat ?? '')), turnId, ...(selection !== undefined ? { selection } : {}) };
      }
      /*
       * The directories this chat is about, when it is about fewer.
       *
       * The protocol requires every entry to be in the owning session's
       * set: a chat cannot reach anywhere its session cannot, and one that
       * named somewhere else would be asking the host to widen a session
       * through a chat. The first entry is the process root and is the
       * session's, so what a chat chooses among is the peers.
       */
      const asked = (Array.isArray(params.workingDirectories) ? params.workingDirectories : [])
        .filter((one): one is string => typeof one === 'string')
        .map((one) => localPath(one));
      const own = [held.workingDirectory, ...(held.additional ?? [])].filter((one) => one !== undefined);
      const stray = asked.find((one) => !own.includes(one));
      if (stray !== undefined)
        throw new RpcError(-32602, `${stray} is not a working directory of ${uri}`);
      const peers = asked.length > 0
        ? asked.filter((one) => one !== held.workingDirectory)
        : held.additional;
      if (asked.length > 0) beside.set(chatUri, peers ?? []);
      /*
       * What this chat was made from, written down before it is opened.
       *
       * The record `spawn` writes takes its origin from here, so the store the
       * next process reads says what the live summary says rather than learning
       * it on the next write.
       */
      if (origin !== undefined) madeFrom.set(chatUri, origin);
      const chat = spawn(held.agent, uri, chatUri, chatIdFor(uri, chatUri), backendsOwn(held.config), made, held.workingDirectory, undefined, peers, connection);
      log(`opened ${chatUri} in ${uri}`);
      // `summary`, not `chat`: the reducer reads `action.summary.resource`,
      // and a chat named any other way arrives as a TypeError inside it.
      dispatch(uri, { type: 'session/chatAdded', summary: chatSummary(uri, chatUri, chat) });
      const first_ = (typeof params.initialMessage === 'object' && params.initialMessage !== null
        ? params.initialMessage
        : undefined) as Record<string, unknown> | undefined;
      if (first_ !== undefined) {
        // No action to refuse here: a first message that cannot run as a
        // command fails the call, which the client shows as the chat not
        // opening with it.
        const refused = await beginOrRun(chat, held.agent.provider, crypto.randomUUID(), String(first_.text ?? ''), undefined, messageFrom(first_), connection);
        if (refused !== undefined) throw new Error(refused);
      }
      return null;
    },
    disposeChat: async (params) => {
      // Either spelling, like `subscribe` and a dispatch.
      const chatUri = chatOf(String(params.channel ?? ''));
      const found = byChat.get(chatUri);
      if (!found)
        throw new RpcError(-32001, `No chat at ${chatUri}`);
      const held = sessions.get(found.uri);
      if (held && held.chats.size === 1) {
        // The last one is the session. Removing it would leave a session
        // with nothing to talk to, which `disposeSession` says properly.
        throw new RpcError(-32602, `${chatUri} is the only chat in ${found.uri}; dispose the session instead`);
      }
      found.chat.close();
      byChat.delete(chatUri);
      drafts.delete(chatUri);
      madeFrom.delete(chatUri);
      ctx.links.forgetChat(chatUri);
      held?.chats.delete(chatUri);
      // And the name this chat was given. The store is what keeps a chat's
      // own title rather than the catalogue's derived one, so a chat that
      // has gone takes its title with it rather than leaving it for a chat
      // opened under that name years from now.
      kept.setChatTitle(idOf(found.uri), chatUri, '');
      /*
       * The name the backend keeps this chat's conversation under, read before
       * the record goes: a fork and a chat whose URI names no id the backend
       * took run under an id the record is the only place to hold.
       */
      const own = found.chat.agentId() ?? ctx.recordedChat(idOf(found.uri), chatUri)?.backendId;
      dropChat(found.uri, chatUri);
      /*
       * And what the backend holds of it, when a closed chat is deleted rather
       * than hidden - decision `a-closed-chat-is-hidden-or-deleted`. The chat
       * is closed either way: a backend that would not remove the conversation
       * is a line in the log, raised by the delete itself, rather than a client
       * told its request failed.
       */
      if (ctx.closedChats === 'delete' && held !== undefined && own !== undefined && own !== '') {
        await ctx.deletedChat(own, held.agent, ctx.dirOf(found.uri));
      }
      if (held && held.defaultChat === chatUri) {
        held.defaultChat = [...held.chats.keys()][0] as string;
        // The one that takes over is the one a client naming no chat gets, and
        // one of them must be the chat a session is resumed as.
        keepChat(found.uri, held.defaultChat, undefined, true);
        dispatch(found.uri, { type: 'session/defaultChatChanged', defaultChat: held.defaultChat });
      }
      log(`closed ${chatUri}`);
      dispatch(found.uri, { type: 'session/chatRemoved', chat: chatUri });
      return null;
    },
    disposeSession: async (params) => {
      // The caller, because a delete is not a write: `session:write` lets a
      // member change their own sessions and says nothing about ending
      // somebody else's, and this one cannot be undone.
      await removeSession(heldAs(String(params.channel ?? '')), connection.principal);
      return null;
    },
    /**
     * The configuration a session would have, before one exists.
     *
     * Separate from a session's own config precisely because it has to be
     * answerable with no session: what a composer offers has to be
     * offerable before anything has been created.
     */
    /**
     * The schema, and what it defaults to.
     *
     * `schema`, not `properties` at the top level: a client reads
     * `result.schema.properties`, and putting them one level up draws no
     * controls at all - no permission mode, no model, no effort. Which is
     * exactly what it did.
     */
    resolveSessionConfig: async (params) => {
      const provider = String(params.provider ?? first.provider);
      const agent = agents.get(provider);
      if (!agent)
        throw new RpcError(-32002, `No provider called ${provider}`);
      const answered = (typeof params.config === 'object' && params.config !== null
        ? params.config
        : {}) as Record<string, unknown>;
      /*
       * The host's own properties, merged over the backend's.
       *
       * Over rather than under: `isolation` and its two companions are
       * this host's to answer, and a backend that happened to advertise
       * the same names would be advertising control of a directory it
       * does not choose.
       */
      /*
       * `workingDirectory`, singular, because that is the field this
       * command declares.
       *
       * `createSession` takes `workingDirectories` and this one does not,
       * and reading the plural here meant the answer was always computed
       * against the host's own first path instead of the folder the
       * question was about - so a client asking about a repository was
       * told what a non-repository offers, which is no isolation at all.
       * The plural is still read after it, for a client that sends what
       * the neighbouring command takes.
       */
      const one = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
      const asked = one ?? (Array.isArray(params.workingDirectories)
        ? params.workingDirectories.find((entry) => typeof entry === 'string')
        : undefined);
      const mine = await isolating(
        typeof asked === 'string' ? localPath(asked) : dir,
        typeof answered.isolation === 'string' ? answered.isolation : undefined,
      );
      /*
       * The same picker a session of this host's own is created with, asked
       * for the person asking: `resolveSessionConfig` is what a client
       * draws its new-session form from, so a scope missing from it is a
       * scope nobody can pick before the session exists.
       */
      const scoped = scoping(connection.principal);
      const theirs = sessionSchema(agent);
      /*
       * A contributed key's own values, asked for here rather than left
       * to the first client that opens its picker: this is the answer a
       * composer draws itself from, and a key marked `enumDynamic` with
       * nothing in its `enum` is a control with no label for the value it
       * is already holding.
       */
      const contributed = await seeded(
        (typeof theirs.properties === 'object' && theirs.properties !== null ? theirs.properties : {}) as Bag,
        { provider, ...(asked === undefined ? {} : { workingDirectory: asked }), config: answered },
      );
      const properties = {
        ...contributed,
        ...(typeof mine.schema.properties === 'object' && mine.schema.properties !== null ? mine.schema.properties : {}),
        ...scoped.properties,
      };
      // Iterative, as a real host's is: what has been answered comes back
      // answered, so re-asking does not quietly undo a choice.
      return {
        schema: { ...theirs, properties },
        values: { ...agent.defaults(), ...mine.defaults, ...scoped.defaults, ...answered },
      };
    },
    /**
     * The values behind a property whose list is too long to send.
     *
     * Only `branch`, because it is the only key here with more values than
     * a picker holds - the rest are enums of five things or fewer, and a
     * client is told so by their schema. A property this host has no
     * lookup for answers with nothing rather than an error: the client
     * asked what else there is, and "nothing else" is an answer.
     */
    sessionConfigCompletions: async (params) => {
      const property = String(params.property ?? '');
      const asked = typeof params.workingDirectory === 'string' ? params.workingDirectory : undefined;
      /*
       * A contributed key answers for itself, before the host's own.
       *
       * Without this a key a plugin named reached every client as a text
       * box: a property with no `enum` reads as a fact somebody types, so
       * only a client holding code for that key by name could draw a
       * picker for it. The answerer is registered beside the key, and the
       * fold is what marks the property `enumDynamic`, so a client asking
       * is a client that was told to ask.
       */
      const answerer = options.sessionConfigCompletions?.[property];
      if (answerer !== undefined) {
        try {
          /*
           * A picker that fails is an empty picker.
           *
           * The person is filling in a session's settings, and a machine
           * listing that cannot be read is not a reason to refuse them the
           * rest of the form. The `try` covers the call as well as the
           * promise, because an answerer that throws before it returns one
           * would otherwise escape a `.catch` on the result.
           */
          return {
            items: await answerer({
              property,
              query: typeof params.query === 'string' ? params.query : '',
              ...(typeof params.provider === 'string' ? { provider: params.provider } : {}),
              ...(asked === undefined ? {} : { workingDirectory: asked }),
              ...(typeof params.config === 'object' && params.config !== null
                ? { config: params.config as Record<string, unknown> }
                : {}),
            }),
          };
        }
        catch {
          return { items: [] };
        }
      }
      const port = options.worktrees;
      if (property === 'scope') {
        /*
         * The choices are the asking person's, so asked for here rather
         * than offered in the enum alone: a person with a `team:*` holds
         * one choice per project, and a client that would rather not draw
         * them all asks. A host with nobody signed in has nothing to offer
         * and says so with an empty list, like any other property here.
         */
        const who = connection.principal;
        if (who === undefined) return { items: [] };
        const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
        const found = namesOf(who).filter((one) => one.toLowerCase().includes(query));
        return { items: found.map((name) => ({ value: name, label: name })) };
      }
      if (property !== 'branch' || !port) return { items: [] };
      // The client's URI is decoded; the host's own directory is already a
      // path, so it is the fallback rather than a URI built to be read back.
      const where = asked === undefined ? dir : localPath(asked);
      const repository = await port.repository(where).catch(() => undefined);
      if (repository === undefined) return { items: [] };
      const query = typeof params.query === 'string' ? params.query.toLowerCase() : '';
      const branches = await port.branches(repository).catch(() => [] as string[]);
      /*
       * Substring rather than prefix, and capped.
       *
       * Somebody looking for `softov/agents/1a2b` types `1a2b`, and a
       * prefix match would answer nothing. The cap is the same one the
       * schema seeds with, because the list is ordered by most recent
       * commit and a picker showing four hundred rows is one nobody reads.
       */
      const found = branches.filter((name) => name.toLowerCase().includes(query));
      return { items: found.slice(0, SEEDS).map((name) => ({ value: name, label: name })) };
    },
  };
}
