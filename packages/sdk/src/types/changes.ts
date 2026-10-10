/** What a session changed, as the protocol's changeset channel carries it. */

import type {
  ChangesetOperationScope as Scope,
  ChangesetOperationTargetKind as TargetKind,
  ChangesetStatus,
  FileEdit,
} from '@microsoft/agent-host-protocol';
import type { PullRequests } from './github.js';

/**
 * The protocol's own names for a file edit, taken rather than written again.
 *
 * This host wrote the same shape by hand, which is a copy that drifts. It had
 * already drifted: `nonce` was missing from the content reference, and `diff`
 * carried its own inline type instead of the protocol's `FileEditDiffStats`.
 *
 * Of `FileEdit`: `before` absent is a creation and `after` absent a deletion,
 * which is how the protocol says both rather than carrying a status word.
 */
export type { ContentRef, FileEdit, FileEditSide, FileEditCollection } from '@microsoft/agent-host-protocol';

/** One row of a changeset. `id` is stable within it. */
export interface ChangesetFile {
  id: string;
  edit: FileEdit;
  reviewed?: boolean;
  /**
   * Server-defined metadata, the protocol's opaque bag.
   *
   * This host puts `staged` and `unstaged` here for an `uncommitted` scope, so a
   * client can tell a change the index already holds from one it does not. The
   * protocol declares no staging field and leaves `_meta` for exactly this.
   */
  _meta?: Record<string, unknown>;
}

/** What a client subscribed to a changeset URI is looking at. */
export interface ChangesetState {
  /**
   * Where the computation is, in the protocol's own three words.
   *
   * Taken from `ChangesetStatus` rather than written out. This port said
   * `computing | complete | error` for the life of the project and the
   * protocol says `computing | ready | error`, so every changeset ever served
   * carried a status word no client could recognise - and nothing caught it,
   * because a hand-copied union is checked against nothing.
   */
  status: `${ChangesetStatus}`;
  files: ChangesetFile[];
}

/** The roll-up a catalogue row carries, so a list needs no subscription. */
export interface ChangesSummary {
  files?: number;
  additions?: number;
  deletions?: number;
}

/**
 * One scope of change a directory can be asked about.
 *
 * The protocol nests changesets under the session's own URI - `uncommitted`,
 * `session`, `turn/<id>` - so a scope is the last part and the host composes
 * the rest. Keeping it that way round means a source never has to know what a
 * session is called.
 */
export interface ChangesetScope {
  /** The path segment, e.g. `uncommitted`. */
  id: string;
  /** What a client shows, e.g. `Uncommitted Changes`. */
  label: string;
  description?: string;
  /**
   * What kind of changeset this is, so a client can group and sort without
   * parsing the URI. The protocol names `session`, `branch`, `uncommitted`,
   * `turn` and `compare-turns`, and says a client should fall back sensibly
   * on one it does not know.
   */
  changeKind: string;
  /**
   * Whether files in this changeset can be marked reviewed.
   *
   * A presence flag on the catalogue entry, which is what lets a client decide
   * whether to draw the checkbox *before* it subscribes to anything. Review is
   * not an operation: the client dispatches `changeset/filesReviewChanged` and
   * the server keeps the flag.
   */
  reviewable?: boolean;
}

/**
 * Where an operation may be invoked.
 *
 * The protocol's three: the whole changeset, one file in it, or a line range
 * within one file. A source declares which it accepts and the host refuses an
 * invocation whose target is not among them.
 */
export type ChangesetOperationScope = `${Scope}`;

/** The file, or the lines of it, an operation was pointed at. */
export interface ChangesetOperationTarget {
  kind: `${TargetKind}`;
  /** The `ChangesetFile.id` of the row, which is a `file://` URI. */
  resource: string;
  /** Which side of the edit, where an operation can act on either. */
  side?: 'before' | 'after';
  /** Present iff `kind` is `range`. Lines are 1-based, as the protocol has them. */
  range?: { startLine: number; startColumn?: number; endLine: number; endColumn?: number };
}

/**
 * A verb a client may run against a changeset.
 *
 * Server-advertised, and that is the whole access model: `invokeChangesetOperation`
 * carries an `operationId` that must match one this source already offered for
 * this scope, so a client can ask for nothing that was not put in front of it.
 *
 * There is no `status` here because status is not the source's. Whether an
 * operation is disabled depends on whether the session is mid-turn, and whether
 * it is running depends on an invocation in flight - both of which the host
 * knows and a source does not.
 */
export interface ChangesetOperation {
  /** Stable within the changeset, and what an invocation names. */
  id: string;
  /** The button. */
  label: string;
  /** Longer text, for a tooltip. */
  description?: string;
  /** The targets this operation accepts. */
  scopes: ChangesetOperationScope[];
  /**
   * The question to ask before running it.
   *
   * Its presence is also how the protocol says "this is destructive": a client
   * MUST show it, and SHOULD style the affirmative button as a warning.
   */
  confirmation?: string;
  /** A hint, e.g. `git-commit` or `discard`. */
  icon?: string;
  /** Operations sharing one are drawn together. */
  group?: string;
  /**
   * Whether running it writes to the working tree.
   *
   * Descriptive: it says what invoking this would do, so a client can draw the
   * verb as the destructive one it is. The host does not gate on it - an
   * operation that writes is served like any other, and the source is what
   * refuses one it cannot carry out. Declared here rather than inferred from
   * the id, because the host cannot know what a source's verbs do.
   */
  writes?: boolean;
}

/**
 * What the host knows about a session that bears on which verbs to offer.
 *
 * All of it is the host's rather than this source's: which branch a worktree
 * was cut from, whether GitHub can be asked, whether it already has a pull
 * request for this branch, and whether anything has been said in the session
 * yet. Handed to `operations` so the source can decide, and to `invoke` so
 * the operation can act on the same facts it was offered against.
 */
export interface ChangesetOperationContext {
  /** The branch the session's tree was cut from, when the host chose one. */
  base?: string;
  /**
   * How to ask GitHub, when the host was given a way and the directory's
   * remote is a GitHub one. With the token a client lent, if one has.
   */
  github?: { ask: PullRequests; token?: string; owner: string; repo: string };
  /** A pull request is already known for the branch the tree is on. */
  pullRequest?: boolean;
  /** Nothing has been said in the session yet, so its tree is nobody's work. */
  unused?: boolean;
  /**
   * What the session is called, offered as a commit subject.
   *
   * The host's to know and not this source's: a changeset is a set of files and
   * a session is a conversation, and the sentence somebody would write on a
   * commit is in the second one. `operations` names it in the commit's
   * confirmation and `invoke` commits under it.
   */
  subject?: string;
}

/** One invocation, as the host hands it to the source. */
export interface ChangesetOperationRequest extends ChangesetOperationContext {
  dir: string;
  session: string;
  /** The scope segment, e.g. `uncommitted` or `turn/abc`. */
  scope: string;
  operationId: string;
  /** Absent for a changeset-scoped operation. */
  target?: ChangesetOperationTarget;
  /**
   * The request's `_meta`, verbatim.
   *
   * The reference client puts an operation's arguments there - the title and
   * body of a pull request under `vscode.pullRequest`, the branch to check
   * out under `treeish` - and an operation that takes arguments reads them
   * from here under the same names.
   */
  meta?: Record<string, unknown>;
}

/** What an invocation says for itself. Thrown errors are the failure path. */
export interface ChangesetOperationResult {
  /** One line for the client to show, plain or as markdown. */
  message?: string | { markdown: string };
  /**
   * Something to open afterwards, when the operation produced one.
   *
   * A `ContentRef` - a URI, a size hint, a content type - and whether the
   * client should open it in a browser rather than inline. A pull request a
   * commit-and-push produced is the case this exists for: the operation
   * succeeded, and the useful thing about it is a page somewhere.
   */
  followUp?: {
    content: { uri: string; sizeHint?: number; contentType?: string; nonce?: string };
    external?: boolean;
  };
  /**
   * Something the session should hold afterwards, when the operation produced it.
   *
   * A pull request an operation opened or found again is the case: the host
   * records it as a session artifact and associates its URL with the branch.
   * The source names the branch it landed on, since only it knows which remote
   * branch it pushed to.
   */
  pullRequest?: { url: string; title: string; branch: string };
}

/**
 * What `ChangesetSource.watch` returns: a call that stops the watch.
 *
 * `ready` resolves once the source's watchers are armed, or once it has given
 * up arming them. A change made before then reaches no watcher, so the host
 * reads the directory again when it resolves. A source without `ready` is
 * taken as armed from the start.
 */
export type ChangesetWatch = (() => void) & { ready?: Promise<void> };

/**
 * Where a host's file changes come from.
 *
 * A port, like the filesystem and the shell, and for the sharpest version of
 * the same reason: a diff comes from `git`, which is a binary that may not be
 * installed, against a directory that may not be a repository. A host given
 * none advertises no changesets, which is a true answer rather than an empty
 * screen.
 */
export interface ChangesetSource {
  /**
   * Which scopes can be answered here. Empty for a directory that has none.
   *
   * `session` is passed because two of the protocol's scopes are a session's
   * rather than a directory's - what *this conversation* changed is not what
   * the working tree looks like, and a directory with three sessions in it has
   * three different answers.
   */
  scopes(dir: string, session: string): ChangesetScope[];
  /** The state behind one of them. */
  state(dir: string, session: string, scope: string): Promise<ChangesetState | undefined>;
  /** The roll-up for a catalogue row, cheap enough to ask per row. */
  summary(dir: string): ChangesSummary | undefined;
  /**
   * Content behind a ref this source minted.
   *
   * The `before` side of an edit is not a file on disk - it is what the file
   * used to be - so it cannot be served by the filesystem port. Undefined for
   * a URI this source does not own, which is how the host knows to try the
   * filesystem instead.
   */
  read?(uri: string): Promise<{ data: string; encoding: string } | undefined>;
  /** Look again, answering whether anything moved. */
  refresh?(dir: string): Promise<boolean>;
  /**
   * Watch a directory for a change a re-read would see and nothing else reports.
   *
   * The index and HEAD move when somebody stages, commits or checks out in a
   * program this host is not, and no client writes through the host for that.
   * `onChange` is called after the source has debounced its own events, and the
   * returned function stops the watch. `undefined` is a source that cannot
   * watch, which is most of them; the host then has only its other triggers.
   */
  watch?(dir: string, onChange: () => void): ChangesetWatch | undefined;
  /**
   * Mark files reviewed, or clear them.
   *
   * A person's bookkeeping about a diff they are reading, not a change to
   * anything on disk - which is why it is the one thing here a client may
   * write. Answers whether anything moved, so an idempotent toggle tells
   * nobody about a state it already had.
   */
  review?(dir: string, session: string, scope: string, files: string[], reviewed: boolean): boolean;
  /**
   * A file an agent is about to change, and the same file once it has.
   *
   * What makes a *turn's* changeset the turn's. Git can only ever say what a
   * working tree looks like now, so a turn asked about later would be handed
   * every turn after it as well; capturing both sides as the tool runs is the
   * only way the answer stays the turn's own.
   *
   * Reading the file is this source's business - it is the thing here that
   * has a filesystem - and the session only says which one and when. `text`
   * is a side the caller already holds, which no read can find afterwards:
   * a file the agent says it changed has already been written, and what it
   * held before is only in the diff the agent sent. The promise is what a
   * caller waits for, so a `before` is read before the write that follows it.
   */
  observe?(dir: string, session: string, turnId: string, path: string, phase: 'before' | 'after', text?: string): Promise<void> | void;
  /**
   * A file a *person* is being asked to approve, and the text the tool would leave.
   *
   * Where `observe` records a turn that is already running, this is a question
   * nobody has answered yet. The tool has not run, so the file on disk is what
   * it was offered and the text it would write is on no disk at all: `apply`
   * makes it from what is there, and this source holds it for the client to
   * read while the question is open.
   *
   * `apply` is given what the file holds now, or `undefined` when there is no
   * such file, and answers the text the tool would leave. Undefined is also
   * the answer for a tool whose change cannot be worked out from its input, or
   * for a file the input does not name. Either way the caller gets no preview
   * and sends its confirmation as it would have without one: a question is
   * never held back for want of a preview.
   *
   * Reading the file is this source's business, as it is for `observe` - this
   * is the part of the host that has a filesystem.
   */
  propose?(dir: string, session: string, toolCallId: string, path: string, apply: (current: string | undefined) => string | undefined): Promise<FileEdit | undefined>;
  /**
   * The preview for a call is done with, so what it was serving goes.
   *
   * Called once the person has answered the question, whichever way they
   * answered, and when the session that asked is closed. A client that reads
   * the URI afterwards is told there is nothing there, rather than being
   * served a file that is no longer what the tool would leave.
   */
  settle?(session: string, toolCallId: string): void;
  /**
   * The verbs this source offers on one scope, in the order to draw them.
   *
   * Asked per scope because the answer differs by scope: the working tree can
   * be committed and a turn cannot, and what a turn changed can be put back
   * because both sides of every file in it were captured.
   *
   * Empty is a real answer and the one to give for a scope with nothing to do
   * to it. A source with no method at all advertises none anywhere, which is
   * what a host serving a directory it may not write looks like.
   */
  operations?(dir: string, session: string, scope: string, context?: ChangesetOperationContext): ChangesetOperation[];
  /**
   * Run one.
   *
   * The host has already checked that `operationId` is among what this source
   * offered for this scope and that the target's kind is one the operation
   * accepts. What is left is doing it, and throwing if it did not work - the
   * protocol signals failure by rejecting the request, not by a field on the
   * result.
   * An error thrown with a numeric `code` is the request's error code, and
   * its `data` goes with it; anything else is an internal error carrying the
   * message.
   */
  invoke?(request: ChangesetOperationRequest): Promise<ChangesetOperationResult>;
}
