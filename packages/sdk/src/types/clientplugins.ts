/** Where the plugins a client hands a session are kept. */

/**
 * One plugin a client announced in a session, as the thing to copy.
 *
 * A client publishes a plugin as a URI and a token for the revision it is
 * publishing, so a body that changed is a new URI-or-nonce pair and a body
 * that did not is the pair this host already has a copy of.
 */
export interface AnnouncedPlugin {
  /** The URI the client published the plugin at, which is what names it. */
  uri: string;
  /**
   * The client's opaque token for the revision it is publishing.
   *
   * Absent is a plugin the client has no revision for, which is filed under
   * one name so a second announcement of the same URI is the same copy.
   */
  nonce?: string;
}

/**
 * What a copy answered for one announced plugin: where it is, or why not.
 *
 * A copy that is already there answers its directory without a byte crossing
 * the connection, and one whose URI is a `file:` path under the copy directory
 * answers that path - it is already where a copy would have put it.
 */
export type SyncedPlugin =
  | { uri: string; nonce?: string; path: string }
  | { uri: string; nonce?: string; error: string };

/**
 * Where a client's plugins are kept on this host.
 *
 * The host's port for the one thing it cannot do for itself: a client's plugin
 * lives on the client's machine - a filesystem provider's tree, an editor's
 * unsaved buffers - and a backend that runs here can only open a path that is
 * here. So each plugin is copied into the host's own directory and the backend
 * is handed that.
 *
 * A host handed none keeps no client plugins, and says so rather than dropping
 * them: an install with no configuration directory has nowhere to put a copy,
 * and a client that announced one is owed the reason.
 */
export interface ClientPlugins {
  /**
   * Copy each plugin a client announced, and answer where each one landed.
   *
   * One answer per plugin, in the order given, never a rejection: a plugin that
   * could not be copied is the error it failed with, because the rest of the
   * list is still worth copying and a client that announced five plugins should
   * not lose four of them to one unreadable file. A URI the client no longer
   * serves is that plugin's error and nothing else's.
   *
   * `client` is the id the client gave at `initialize`, which is who the copy
   * reads from.
   */
  sync(client: string, plugins: AnnouncedPlugin[]): Promise<SyncedPlugin[]>;
}
