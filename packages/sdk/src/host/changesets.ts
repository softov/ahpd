import type { ChangesetFile } from '@microsoft/agent-host-protocol';
import { idOf, Status } from '../catalog.js';
import { localPath, uriOf } from '../fileuri.js';
import { chatUriFor } from './channels.js';
import type {
  ChangeWords, ChangeWordsAsk, ChangeWordsMode, ChangeWordsSetting, ChangesetOperationContext, ChangesetState,
} from '../types/changes.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';
import type { Held } from './state.js';
import type { HostContext } from './context.js';

/**
 * The most of a conversation a prompt carries.
 *
 * A session that has been talking for an hour is not a prompt, and naming the
 * work needs the shape of the conversation rather than every word of it. The
 * cut is said where it is made, so a reader is not left taking a sentence that
 * stops mid-way for the whole of what was said.
 */
const CONVERSATION_MOST = 8_000;

/**
 * How long a turn asked for the words is waited for, in milliseconds.
 *
 * Two minutes: long enough for a model to read a diff and write a paragraph,
 * short enough that a commit is not left hanging on one. A session asking a
 * model for a title has nobody to cancel the turn, so this is what ends one
 * that no backend ever finished. `changeWordsTimeoutMs` sets it, and `0` there
 * means no limit at all.
 */
const CHANGE_WORDS_MOST = 2 * 60_000;

/** The four places the words can come from, as the schema declares them. */
const MODES = new Set<string>(['session-title', 'forced', 'model', 'agent']);

/** What a session's changesets offer the rest of the host. */
export interface Changesets {
  dirOf(uri: string): string | undefined;
  catalogueOf(uri: string, dir: string): Bag[];
  changesetAt(channel: string): { owner: string; scope: string; dir: string } | undefined;
  changesetOf(channel: string, uri: string): boolean;
  operationsOf(channel: string): Bag[];
  operationsMoved(uri: string): void;
  contentMoved(uri: string): Promise<void>;
  changesetsOf(uri: string): Bag;
  operationContext(asked: string, dir: string): ChangesetOperationContext;
  opKey(channel: string, id: string): string;
  inFlight: Set<string>;
  lastError: Map<string, string>;
  shown: Map<string, { files: ChangesetFile[]; status: string }>;
}

export function createChangesets(ctx: HostContext): Changesets {
  const { options, connections, sessions, heldAs, leadOf, wheres, worktrees, githubFacts, lent, dispatch } = ctx;

  /**
   * The directory a session works in, as a path.
   *
   * Every description of a session wants it - the project name and the branch
   * both come from it - and the two places it is kept spell it as a `file://`
   * URI, which git and `basename` do not take.
   */
  const dirOf = (uri: string): string | undefined => {
    const named = heldAs(uri);
    const held = sessions.get(named);
    const lead = held && leadOf(held);
    const where = lead?.workingDirectories()[0] ?? wheres.get(named)?.[0];
    return where === undefined ? undefined : localPath(where);
  };

  /**
   * The changesets a session advertises, as catalogue entries.
   *
   * One builder, because there are two places that say them - a session's
   * state and the action that says they moved - and an entry that carried a
   * capability in one and not the other would be a client drawing a checkbox
   * that vanished when anything changed.
   */
  const catalogueOf = (uri: string, dir: string): Bag[] =>
    (options.changes?.scopes(dir, uri) ?? []).map((scope) => ({
      label: scope.label,
      uriTemplate: `${uri}/changeset/${scope.id}`,
      changeKind: scope.changeKind,
      ...(scope.description ? { description: scope.description } : {}),
      // A presence flag, and on the *catalogue* entry so a client can decide
      // whether to draw a checkbox before it subscribes to anything.
      ...(scope.reviewable ? { capabilities: { review: {} } } : {}),
    }));

  /**
   * What one changeset URI is a changeset *of*.
   *
   * `<sessionUri>/changeset/<scope>` split back into its two halves, which is
   * wanted in four places now. Undefined for a URI that is not one.
   */
  const changesetAt = (channel: string): { owner: string; scope: string; dir: string } | undefined => {
    const cut = channel.indexOf('/changeset/');
    if (cut <= 0) return undefined;
    const owner = channel.slice(0, cut);
    const dir = dirOf(owner);
    if (dir === undefined) return undefined;
    return { owner, scope: channel.slice(cut + '/changeset/'.length), dir };
  };

  /**
   * Whether a changeset channel is one of a session's, under any spelling of it.
   *
   * A changeset is watched under the name the client used for its session,
   * so a scan of what connections watch looks through that name to the
   * session it is held as.
   */
  const changesetOf = (channel: string, uri: string): boolean => {
    const cut = channel.indexOf('/changeset/');
    return cut > 0 && (channel.slice(0, cut) === uri || heldAs(channel.slice(0, cut)) === uri);
  };

  /**
   * Invocations in flight, and the last one that failed.
   *
   * Keyed by changeset and operation, because status is per operation on a
   * changeset rather than per source: two clients looking at the same
   * changeset must see the same spinner, which is the whole reason the
   * protocol reflects an imperative call back into state.
   */
  const inFlight = new Set<string>();
  const lastError = new Map<string, string>();
  const opKey = (channel: string, id: string): string => `${channel}\u0000${id}`;

  /**
   * The answer a chat's newest turn ended with, as text.
   *
   * What a model says comes back as response parts rather than as a message,
   * and a markdown part is its words. Nothing at all where the turn ended
   * without saying anything, which is what a cancellation and a failed turn
   * both look like from here.
   */
  const saidIn = (turn: Bag | undefined): string | undefined => {
    const parts = Array.isArray(turn?.responseParts) ? turn.responseParts as Bag[] : [];
    const said = parts
      .filter((part) => part.kind === 'markdown')
      .map((part) => String(part.content ?? ''))
      .join('')
      .trim();
    return said === '' ? undefined : said;
  };

  /** The answer a chat's newest turn ended with. */
  const answerOf = (chat: Session): string | undefined => saidIn(chat.allTurns().at(-1) as Bag | undefined);

  /**
   * What has been said in a session, as one prompt carries it.
   *
   * What the person asked for and what the session answered, in order, with
   * the person's own words marked as a quotation so a reader can tell the two
   * apart. A model asked to name work it did not do has only this to go on,
   * and a title drawn from it is about the intention rather than about the
   * diff alone.
   */
  const conversationOf = (lead: Session | undefined): string | undefined => {
    const turns = lead?.allTurns() as Bag[] | undefined;
    if (turns === undefined || turns.length === 0) return undefined;
    const said: string[] = [];
    for (const turn of turns) {
      const message = (turn.message ?? {}) as Bag;
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (text !== '') said.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
      const answered = saidIn(turn);
      if (answered !== undefined) said.push(answered);
    }
    if (said.length === 0) return undefined;
    const whole = said.join('\n\n');
    return whole.length <= CONVERSATION_MOST ? whole : `${whole.slice(0, CONVERSATION_MOST)}\n... the conversation was cut here.`;
  };

  /**
   * One turn, and the limit on waiting for it.
   *
   * The reader is armed before the turn starts, because a turn that answered
   * before anything was listening would leave this waiting for an end that had
   * already happened. `chat/turnComplete`, `chat/turnCancelled` and
   * `chat/error` are the three ways a turn stops, and `true` is all three,
   * because the answer is read off the turn whichever of them it was - a
   * cancelled turn that said something first has still said it.
   *
   * An event names the session and not the chat, so a turn that ends in
   * another chat of the same session is one too. Only a turn more on the
   * watched chat than it had when the wait began is this turn's end.
   *
   * `false` is the limit: `CHANGE_WORDS_MOST`, or whatever
   * `changeWordsTimeoutMs` says. A turn this host opened for the words alone
   * has nobody else to cancel it, so the limit is what ends one that no
   * backend ever finished. The turn is stopped rather than merely abandoned,
   * because a model still going would spend on words nobody will read, and
   * the answer is `false` for the caller to fall back on.
   */
  const watchTurn = (session: Session, uri: string, turnId: string): { ended: Promise<boolean>; stop: () => void } => {
    const limit = ctx.options.changeWordsTimeoutMs ?? CHANGE_WORDS_MOST;
    let stop: (() => void) | undefined;
    let late: ReturnType<typeof setTimeout> | undefined;
    const before = session.allTurns().length;
    const ended = new Promise<boolean>((resolve) => {
      stop = ctx.sessionEvents.watch((event) => {
        if (event.session !== uri) return;
        if (event.kind !== 'turnCompleted' && event.kind !== 'turnCancelled' && event.kind !== 'turnFailed') return;
        if (session.allTurns().length > before) resolve(true);
      });
      // Zero is no limit at all, which is how `clientToolTimeoutMs` reads it.
      if (limit <= 0) return;
      late = setTimeout(() => {
        ctx.log(`${uri} had not answered after ${limit}ms, so the turn was stopped`);
        /*
         * A backend that throws here is a line in the log and nothing else.
         * The throw would otherwise leave the timer, where nothing catches
         * it, and the ask waiting on a turn that is never going to end - the
         * one thing this limit exists to prevent.
         */
        try { session.cancel(turnId); }
        catch (error) {
          ctx.log(`${uri} could not be stopped: ${error instanceof Error ? error.message : String(error)}`);
        }
        resolve(false);
      }, limit);
    });
    return {
      ended,
      stop: () => {
        stop?.();
        if (late !== undefined) clearTimeout(late);
      },
    };
  };

  /**
   * A model on a session of its own, asked one question and let go of.
   *
   * The session is named after its provider, works in the directory the
   * changeset is about, is offered no tools at all and runs one turn. It is
   * disposed of once it has answered, so nothing of it is left - the answer is
   * the whole of what it was for.
   */
  const askModel = (provider: string, model: string, dir: string): ChangeWordsAsk => async (prompt: string): Promise<string | undefined> => {
    const uri = `${provider}:/${crypto.randomUUID()}`;
    const turnId = crypto.randomUUID();
    let watching: ReturnType<typeof watchTurn> | undefined;
    try {
      ctx.bareSessions.add(uri);
      ctx.openSession(uri, provider, {}, uriOf(dir));
      const held = sessions.get(uri);
      const lead = held === undefined ? undefined : leadOf(held);
      if (lead === undefined) return undefined;
      watching = watchTurn(lead, uri, turnId);
      const refused = ctx.beginOrRun(lead, provider, turnId, prompt, { id: model }, { origin: { kind: 'systemNotification' } });
      const why = refused instanceof Promise ? await refused : refused;
      if (why !== undefined) {
        ctx.log(`${provider} was asked for the words of ${dir} and refused: ${why}`);
        return undefined;
      }
      if (!await watching.ended) return undefined;
      return answerOf(lead);
    }
    catch (error) {
      ctx.log(`${provider} could not write the words of ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    finally {
      watching?.stop();
      ctx.bareSessions.delete(uri);
      // After the hold is lifted, so the teardown is not itself bare - it is
      // not a turn, and a session being disposed of has nothing left to call.
      if (sessions.has(uri)) await ctx.removeSession(uri);
    }
  };

  /**
   * The session's own agent, asked in a side chat.
   *
   * The same shape a client's `createChat` with a `sideChat` source builds: a
   * chat of the same session and the same backend, told what the turn it came
   * from said rather than shown it, which is what the protocol says a side
   * chat's visible history holds. The chat stays afterwards - host/76's
   * *Decisions locked in*, "The side chat stays in the session after it
   * answers" - so the person can read the answer, disagree with it and say so.
   *
   * Built here rather than by calling the request the client's own create
   * chat goes through, because a request handler is not on the context and
   * this is the one caller that is not a request.
   */
  const askAgent = (uri: string, held: Held, lead: Session): ChangeWordsAsk => async (prompt: string): Promise<string | undefined> => {
    const newest = lead.allTurns().at(-1) as Bag | undefined;
    if (newest === undefined) return undefined;
    const message = (newest.message ?? {}) as Bag;
    const chatUri = `ahp-chat://side/${crypto.randomUUID()}`;
    const turnId = crypto.randomUUID();
    let watching: ReturnType<typeof watchTurn> | undefined;
    try {
      ctx.claimable(chatUri, 'chat');
      ctx.madeFrom.set(chatUri, {
        kind: 'sideChat',
        chat: held.defaultChat,
        turnId: String(newest.id ?? ''),
      });
      const chat = ctx.spawn(
        held.agent, uri, chatUri, idOf(chatUri), ctx.backendsOwn(held.config),
        { context: typeof message.text === 'string' ? message.text : '' },
        held.workingDirectory, undefined, held.additional,
      );
      ctx.log(`opened ${chatUri} in ${uri} to write the words`);
      ctx.dispatch(uri, { type: 'session/chatAdded', summary: ctx.chatSummary(uri, chatUri, chat) });
      watching = watchTurn(chat, uri, turnId);
      const refused = ctx.beginOrRun(chat, held.agent.provider, turnId, prompt, undefined, { origin: { kind: 'systemNotification' } });
      const why = refused instanceof Promise ? await refused : refused;
      if (why !== undefined) {
        ctx.log(`${chatUri} was asked for the words and refused: ${why}`);
        return undefined;
      }
      if (!await watching.ended) return undefined;
      return answerOf(chat);
    }
    catch (error) {
      ctx.log(`${chatUri} could not write the words: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    finally { watching?.stop(); }
  };

  /**
   * The setting, with the ask that goes with it.
   *
   * Nothing at all when the key was never pushed, which is a host configured
   * with nothing - the source reads that as the session title, the words this
   * host wrote before there was a setting.
   *
   * A mode that asks and has nothing to ask with carries `why` instead of an
   * ask: the source falls back to the session title and says what went
   * without, which is the whole answer rather than a refusal. The mode is
   * checked here as well as at the push, because the schema's enum is not what
   * holds a value off the wire - `declaresConfigKey` asks whether a key
   * exists, and a client may put anything under it.
   */
  const changeWordsOf = (
    uri: string,
    dir: string,
    held: Held | undefined,
    lead: Session | undefined,
  ): ChangeWords | undefined => {
    const raw = (typeof ctx.rootConfig.changeWords === 'object' && ctx.rootConfig.changeWords !== null
      ? ctx.rootConfig.changeWords
      : undefined) as Bag | undefined;
    const mode = raw === undefined ? '' : String(raw.mode ?? '');
    if (!MODES.has(mode)) return undefined;
    const setting: ChangeWordsSetting = {
      mode: mode as ChangeWordsMode,
      ...(typeof raw?.provider === 'string' ? { provider: raw.provider } : {}),
      ...(typeof raw?.model === 'string' ? { model: raw.model } : {}),
    };
    if (mode === 'model') {
      if (setting.provider === undefined || setting.model === undefined)
        return { setting, why: 'the setting names no provider and model' };
      if (!ctx.agents.has(setting.provider))
        return { setting, why: `${setting.provider} is not a backend this host serves` };
      return { setting, ask: askModel(setting.provider, setting.model, dir) };
    }
    if (mode === 'agent') {
      if (held === undefined || lead === undefined) return { setting, why: 'the session has no chat to ask' };
      if (held.agent.chats?.sideChat !== true) return { setting, why: `${held.agent.provider} cannot start a side chat` };
      if (lead.allTurns().length === 0) return { setting, why: 'the session has no turn to ask from' };
      return { setting, ask: askAgent(uri, held, lead) };
    }
    return { setting };
  };

  /**
   * What the host knows that bears on a changeset's verbs.
   *
   * The base branch it chose for a worktree; GitHub, when there is a way to
   * ask it and the directory's remote is there, with the token a client lent;
   * whether the branch already has a pull request; and whether the session
   * has said anything yet. Read at the moment of asking, since every one of
   * them moves.
   *
   * The last two are what a commit message and a pull request's words are
   * written from: the setting that says where they come from, and what the
   * session has said about the work.
   */
  const operationContext = (asked: string, dir: string): ChangesetOperationContext => {
    const uri = heldAs(asked);
    const base = worktrees.get(uri)?.base;
    const git = (options.directories?.meta(dir) as { git?: Record<string, unknown> } | undefined)?.git;
    const facts = githubFacts.get(dir) as { pullRequestUrls?: string[]; pullRequestBranchName?: string } | undefined;
    const owner = git?.githubOwner;
    const repo = git?.githubRepo;
    const token = options.github === undefined ? undefined : lent(String(options.github.resource.resource ?? ''));
    const github = options.github !== undefined && typeof owner === 'string' && typeof repo === 'string'
      ? { ask: options.github, owner, repo, ...(token === undefined ? {} : { token }) }
      : undefined;
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    const words = changeWordsOf(uri, dir, held, lead);
    const conversation = conversationOf(lead);
    return {
      ...(base !== undefined && base !== 'HEAD' ? { base } : {}),
      ...(github !== undefined ? { github } : {}),
      ...(facts?.pullRequestUrls !== undefined && facts.pullRequestBranchName === git?.branchName ? { pullRequest: true } : {}),
      ...(lead !== undefined && lead.allTurns().length === 0 ? { unused: true } : {}),
      ...(lead !== undefined ? { subject: lead.title() } : {}),
      ...(words !== undefined ? { changeWords: words } : {}),
      ...(conversation !== undefined ? { conversation } : {}),
    };
  };

  /**
   * The operations a changeset offers, with the status the host owns.
   *
   * The source declares the verbs and this decides what may be pressed:
   * `Disabled` while the session is mid-turn, because the working tree is
   * being written by the agent and an operation that mutated it underneath
   * would race the thing that is doing the work; `Running` while an invocation
   * is out; `Error` carrying whatever the last one said.
   */
  const operationsOf = (channel: string): Bag[] => {
    const at = changesetAt(channel);
    if (!at) return [];
    const busy = (ctx.statusOf(at.owner) & Status.InProgress) !== 0;
    return (options.changes?.operations?.(at.dir, at.owner, at.scope, operationContext(at.owner, at.dir)) ?? []).map((operation) => {
      const key = opKey(channel, operation.id);
      const failure = lastError.get(key);
      const status = inFlight.has(key) ? 'running'
        : busy ? 'disabled'
          : failure !== undefined ? 'error'
            : 'idle';
      return {
        id: operation.id,
        label: operation.label,
        ...(operation.description !== undefined ? { description: operation.description } : {}),
        scopes: operation.scopes,
        ...(operation.confirmation !== undefined ? { confirmation: operation.confirmation } : {}),
        ...(operation.icon !== undefined ? { icon: operation.icon } : {}),
        ...(operation.group !== undefined ? { group: operation.group } : {}),
        status,
        ...(status === 'error' && failure !== undefined ? { error: { message: failure } } : {}),
      };
    });
  };

  /**
   * Say again what a session's changesets can be told to do.
   *
   * Sent on turn boundaries, because that is when the answer changes without
   * anything in a changeset's *content* moving: a turn starting disables every
   * operation on every changeset the session has, and nothing else would say
   * so. Only channels somebody is watching - a changeset nobody subscribed to
   * has no buttons on screen to correct.
   */
  const operationsMoved = (uri: string): void => {
    const done = new Set<string>();
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (!changesetOf(channel, uri) || done.has(channel)) continue;
        done.add(channel);
        const operations = operationsOf(channel);
        // `undefined` is how the protocol clears the list, and an operation
        // list that went from three to none is exactly that.
        dispatch(channel, {
          type: 'changeset/operationsChanged',
          ...(operations.length > 0 ? { operations } : {}),
        });
      }
    }
  };

  /**
   * What every client watching a changeset was last told it holds.
   *
   * Kept per channel and not per connection, because it is the same for all
   * of them: a snapshot is taken at a `serverSeq` and every action after it
   * goes to everyone, so what one subscriber has is what all of them have.
   */
  const shown = new Map<string, { files: ChangesetFile[]; status: string }>();

  /** Two file lists, same order-independent contents. */
  const sameFiles = (a: ChangesetFile[], b: ChangesetFile[]): boolean => {
    if (a.length !== b.length) return false;
    const was = new Map(a.map((file) => [file.id, JSON.stringify(file)]));
    return b.every((file) => was.get(file.id) === JSON.stringify(file));
  };

  /**
   * A changeset's new contents, said in whichever form is smaller.
   *
   * The incremental actions when a handful of files moved, and the whole set
   * when more moved than there are files to send: a changeset of four hundred
   * files re-sent because one of them changed is the case these exist for, and
   * one of four files sent as five actions is the case they are worse at.
   *
   * The two reduce to the same state, which is what makes choosing between
   * them safe - `changesetReducer` applies `fileSet` and `fileRemoved` to the
   * same list `contentChanged` replaces wholesale.
   */
  const told = (channel: string, state: ChangesetState, operations: Bag[]): void => {
    const files = state.files;
    const status = typeof state.status === 'string' ? state.status : 'idle';
    const was = shown.get(channel);
    const whole = (): void => {
      dispatch(channel, {
        type: 'changeset/contentChanged',
        files,
        ...(operations.length > 0 ? { operations } : {}),
      });
    };
    shown.set(channel, { files, status });
    // Nothing to diff against: this client's first word about the channel is
    // the whole of it, which is what a snapshot would have been.
    if (!was) { whole(); return; }
    if (was.status !== status) dispatch(channel, { type: 'changeset/statusChanged', status });
    if (sameFiles(was.files, files)) {
      // The status moved and the files did not, which is the ordinary shape of
      // a changeset being recomputed. Re-sending the list would be the whole
      // set to say nothing.
      if (operations.length > 0) dispatch(channel, { type: 'changeset/operationsChanged', operations });
      return;
    }
    // Everything gone is one action rather than one per file, which is what
    // the protocol has `cleared` for.
    if (files.length === 0) {
      dispatch(channel, { type: 'changeset/cleared' });
      if (operations.length > 0) dispatch(channel, { type: 'changeset/operationsChanged', operations });
      return;
    }
    const before = new Map(was.files.map((file) => [file.id, JSON.stringify(file)]));
    const now = new Set(files.map((file) => file.id));
    const gone = was.files.filter((file) => !now.has(file.id));
    const moved = files.filter((file) => before.get(file.id) !== JSON.stringify(file));
    if (gone.length + moved.length >= files.length) { whole(); return; }
    for (const file of gone) dispatch(channel, { type: 'changeset/fileRemoved', fileId: file.id });
    for (const file of moved) dispatch(channel, { type: 'changeset/fileSet', file });
    if (operations.length > 0) dispatch(channel, { type: 'changeset/operationsChanged', operations });
  };

  /**
   * The changesets themselves, after something wrote to the tree.
   *
   * `changeset/contentChanged` rather than a fresh snapshot: a client watching
   * a changeset is holding a file list, and an operation that reverted one
   * file has changed that list - which nothing else here says, because the
   * catalogue action carries the *set* of changesets a session offers and not
   * what is in any of them.
   *
   * A watcher that already holds a completed result is told `recomputing`
   * before the read and keeps its files while it runs, which on a large
   * repository is seconds of `git status` and `git diff`. A changeset with no
   * completed result - a first read - has nothing to keep and is told nothing.
   */
  const contentMoved = async (uri: string): Promise<void> => {
    const done = new Set<string>();
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (!changesetOf(channel, uri) || done.has(channel)) continue;
        done.add(channel);
        const at = changesetAt(channel);
        if (!at) continue;
        const was = shown.get(channel);
        const marked = was !== undefined && was.status !== 'computing' && was.status !== 'recomputing';
        if (was && marked) {
          dispatch(channel, { type: 'changeset/statusChanged', status: 'recomputing' });
          // The files stay as they are, which is what the protocol asks of a
          // recomputation and what keeps them on screen while it runs.
          shown.set(channel, { files: was.files, status: 'recomputing' });
        }
        let settled = false;
        try {
          const state = await options.changes?.state(at.dir, at.owner, at.scope);
          if (state) {
            const operations = operationsOf(channel);
            told(channel, state, operations);
            settled = true;
          }
        }
        finally {
          // A read that gave nothing or threw leaves the status it found, so
          // nobody is left holding a spin that ended. The failure goes on to
          // the caller either way.
          if (was && marked && !settled) {
            dispatch(channel, { type: 'changeset/statusChanged', status: was.status });
            shown.set(channel, was);
          }
        }
      }
    }
  };

  /**
   * The changesets this session can be asked about, as URIs a client
   * subscribes to.
   *
   * A field of `SessionState`, and of nothing else. It used to be part of
   * `describes`, which is spread into a `SessionSummary` as well - so every
   * catalogue row and every `root/sessionSummaryChanged` carried a key the
   * protocol does not declare on a summary, and carried it once per row. A
   * receiver ignores what it does not understand, so nothing broke; what it
   * cost was weight on the busiest notification this host sends, and a second
   * place to read an answer the session channel already gives.
   *
   * A template with no variables in it is the whole scope; the ones with
   * `{turnId}` are not served yet.
   */
  const changesetsOf = (uri: string): Bag => {
    const dir = dirOf(uri);
    if (dir === undefined) return {};
    const changesets = catalogueOf(uri, dir);
    return changesets.length > 0 ? { changesets } : {};
  };

  return {
    dirOf, catalogueOf, changesetAt, changesetOf, operationsOf, operationsMoved, contentMoved,
    changesetsOf, operationContext, opKey, inFlight, lastError, shown,
  };
}