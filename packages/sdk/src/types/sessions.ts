/**
 * The pull requests a session's branch had when it started, and the ones it
 * has made its own since.
 *
 * An empty `initialPullRequestUrls` is a captured baseline and not an absent
 * one: it says the branch had none, which is a different answer from a host
 * that never asked. `associatedPullRequestUrls` is what the session took as
 * its own, most recent first. Both keep the spelling they arrived with.
 */
export interface PullRequestBaseline {
  initialPullRequestUrls: string[];
  associatedPullRequestUrls: string[];
}

/**
 * What a host knows about a session that no backend does.
 *
 * Two things, and they have nothing in common except who owns them. `flags`
 * are the client bits every connection shares - `IsRead` says somebody has
 * looked since the last change, `IsArchived` says somebody put it away - and
 * `config` is the settings a session is running under, which the host resolved
 * from a schema and hands back to the backend when it resumes one.
 *
 * Neither belongs to a backend. A transcript comes back from a harness on its
 * own; whether a person has read it does not, and a harness asked would have
 * no idea. So a host holding them in memory is a host that forgets them, and
 * a restart returns every archived session to the catalogue and marks every
 * read one unread - for everybody, with nothing said about it.
 *
 * A port rather than a file, for the reason `AutomationStore` is one: a host
 * embedded in an editor already has somewhere to put this and should not be
 * given a second place, and a host in a test wants none at all. `memorySessions()`
 * is the one that forgets, `fileSessions()` is the one that does not, and
 * `createHost` is told which rather than choosing.
 *
 * **Keyed by the backend's id, not by the URI.** A client may set a flag on a
 * row before this host has listed anything, and until it has, the name it will
 * publish that session under is not yet known. The id is the identity; the
 * scheme is only whose it is.
 */
export interface SessionStore {
  /** The client flags in force, or `0` where none were ever set. */
  flags(id: string): number;
  /** Replace them. The whole bitset, because that is what the protocol sends. */
  setFlags(id: string, value: number): void;
  /** The configuration a session is running under, or nothing where it has none. */
  config(id: string): Record<string, unknown> | undefined;
  /** Replace it. Merging is the caller's, which already holds the defaults. */
  setConfig(id: string, values: Record<string, unknown>): void;
  /**
   * What the agent recorded as worth coming back to, or nothing where it
   * recorded nothing.
   *
   * The reference host's session artifacts and references, as its
   * `add_artifact_or_reference` tool writes them and its window draws them
   * beside the input: `{ id, type, label, isArtifact, link?, uri?,
   * commitHash?, isGitHub? }`. Kept whole and in the order recorded, since a
   * client lists them newest last by that order.
   */
  artifacts(id: string): Record<string, unknown>[] | undefined;
  /** Replace them. Empty forgets them, which is what removing the last one means. */
  setArtifacts(id: string, values: Record<string, unknown>[]): void;
  /**
   * The pull requests this session inherited and the ones it made its own,
   * or nothing where its branch was never asked about.
   *
   * Kept per session rather than per directory, since the baseline is the
   * moment one session began and two sessions in one directory began at
   * different moments.
   */
  pullRequests(id: string): PullRequestBaseline | undefined;
  /**
   * Replace it. An all-empty pair is still a baseline - it says the branch
   * had none - so it is kept rather than dropped.
   */
  setPullRequests(id: string, value: PullRequestBaseline): void;
  /**
   * The title a chat was given, or nothing where it was never named.
   *
   * The catalogue's title is derived and the reference host keeps a chat's
   * own beside it. A chat is not a session: a peer chat's title belongs to
   * that chat, which is why the chat URI is part of the key.
   */
  chatTitle(id: string, chatUri: string): string | undefined;
  /** Set it. An empty string forgets it, which is a title taken back. */
  setChatTitle(id: string, chatUri: string, title: string): void;
  /**
   * Forget a session entirely.
   *
   * Called when one is disposed. Without it a store that survives restarts is
   * a file that only ever grows, carrying flags for sessions that went months
   * ago.
   */
  forget(id: string): void;
}
