/** What a session changed, as the protocol's changeset channel carries it. */

import type {
  ChangesetOperationScope as Scope,
  ChangesetOperationTargetKind as TargetKind,
  ChangesetStatus,
} from '@microsoft/agent-host-protocol';

/** A pointer to content the state tree does not carry. */
export interface ContentRef {
  uri: string;
  sizeHint?: number;
  contentType?: string;
}

/**
 * One file, on both sides of the change.
 *
 * `before` absent is a creation and `after` absent a deletion, which is how
 * the protocol says both rather than carrying a status word for them.
 */
export interface FileEdit {
  before?: { uri: string; content: ContentRef };
  after?: { uri: string; content: ContentRef };
  diff?: { added?: number; removed?: number };
}

/** One row of a changeset. `id` is stable within it. */
export interface ChangesetFile {
  id: string;
  edit: FileEdit;
  reviewed?: boolean;
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
   * What the host gates on: an operation that writes needs a write grant on the
   * resource, negotiated through `resourceRequest`, and is refused with `-32009`
   * until one is held. Declared here rather than inferred from the id, because
   * the host cannot know what a source's verbs do.
   */
  writes?: boolean;
}

/** One invocation, as the host hands it to the source. */
export interface ChangesetOperationRequest {
  dir: string;
  session: string;
  /** The scope segment, e.g. `uncommitted` or `turn/abc`. */
  scope: string;
  operationId: string;
  /** Absent for a changeset-scoped operation. */
  target?: ChangesetOperationTarget;
  /**
   * What the session is called, offered as a commit subject.
   *
   * The host's to know and not this source's: a changeset is a set of files and
   * a session is a conversation, and the sentence somebody would write on a
   * commit is in the second one.
   */
  subject?: string;
}

/** What an invocation says for itself. Thrown errors are the failure path. */
export interface ChangesetOperationResult {
  /** One line for the client to show. */
  message?: string;
}

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
   * has a filesystem - and the session only says which one and when.
   */
  observe?(dir: string, session: string, turnId: string, path: string, phase: 'before' | 'after'): void;
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
  operations?(dir: string, session: string, scope: string): ChangesetOperation[];
  /**
   * Run one.
   *
   * The host has already checked that `operationId` is among what this source
   * offered for this scope, that the target's kind is one the operation
   * accepts, and that a write grant is held where the operation says it writes.
   * What is left is doing it, and throwing if it did not work - the protocol
   * signals failure by rejecting the request, not by a field on the result.
   */
  invoke?(request: ChangesetOperationRequest): Promise<ChangesetOperationResult>;
}
