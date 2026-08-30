/** What a session changed, as the protocol's changeset channel carries it. */

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
  status: 'computing' | 'complete' | 'error';
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
}
