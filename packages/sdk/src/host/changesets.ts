import type { ChangesetFile } from '@microsoft/agent-host-protocol';
import { Status } from '../catalog.js';
import type { ChangesetOperationContext, ChangesetState } from '../types/changes.js';
import type { Bag } from '../types/common.js';
import type { HostContext } from './context.js';

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
    return where?.replace(/^file:\/\//, '');
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
   * What the host knows that bears on a changeset's verbs.
   *
   * The base branch it chose for a worktree; GitHub, when there is a way to
   * ask it and the directory's remote is there, with the token a client lent;
   * whether the branch already has a pull request; and whether the session
   * has said anything yet. Read at the moment of asking, since every one of
   * them moves.
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
    return {
      ...(base !== undefined && base !== 'HEAD' ? { base } : {}),
      ...(github !== undefined ? { github } : {}),
      ...(facts?.pullRequestUrls !== undefined && facts.pullRequestBranchName === git?.branchName ? { pullRequest: true } : {}),
      ...(lead !== undefined && lead.allTurns().length === 0 ? { unused: true } : {}),
      ...(lead !== undefined ? { subject: lead.title() } : {}),
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
   */
  const contentMoved = async (uri: string): Promise<void> => {
    const done = new Set<string>();
    for (const connection of connections) {
      for (const channel of connection.watching) {
        if (!changesetOf(channel, uri) || done.has(channel)) continue;
        done.add(channel);
        const at = changesetAt(channel);
        if (!at) continue;
        const state = await options.changes?.state(at.dir, at.owner, at.scope);
        if (!state) continue;
        const operations = operationsOf(channel);
        told(channel, state, operations);
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