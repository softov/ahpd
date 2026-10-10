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
 * One plugin a template named, as the thing to capture.
 *
 * A template's own entry: the id it publishes the plugin under, the URI it
 * published it at, and the token for the revision. The id is the template's,
 * and two plugins under one id are a template nothing downstream can read.
 */
export interface TemplatePlugin extends AnnouncedPlugin {
  /** The id the template publishes it under, which is how a client names it again. */
  id: string;
  /** What the template calls it. */
  name?: string;
}

/**
 * One plugin a template named, as this host holds it.
 *
 * The URI is this host's own, under the directory the copies live in. That is
 * the whole point of capturing one: a run happens with nobody connected, so
 * what it loads is a path here and never a client's.
 */
export interface CapturedPlugin {
  type: 'plugin';
  /** The id the template published it under. */
  id: string;
  /** Where the copy is, as this host's own `file:` URI. */
  uri: string;
  /** What it is called, which is the template's own name for it or its URI. */
  name: string;
  /** Always `loaded`: a plugin that would not copy refuses the whole write. */
  load: { kind: 'loaded' };
}

/**
 * What one capture answers: the copies, and the way to let go of them.
 *
 * A capture is several reads over one client's connection, and a prune from
 * another write may run between two of them. So every copy it places or finds
 * already there is held back from `prune` until `release` says the write that
 * asked for it has been stored or refused - otherwise a copy that no entry
 * names yet looks exactly like one to remove, and the entry about to name it
 * points at a folder that is gone.
 */
export interface HeldCopies {
  /** One copy per plugin the template named, in the order it named them. */
  copies: CapturedPlugin[];
  /**
   * Let go of the copies, once the write that asked for them has been stored
   * or refused.
   *
   * Called once. A copy that a run was handed is `spare`d separately, and that
   * hold does not end here.
   */
  release(): void;
}

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

  /**
   * Copy the plugins an automation's template names, and answer where each is.
   *
   * A rejection rather than one answer per plugin, and that is the difference
   * between this and `sync`: a session that lost one plugin of five is still a
   * session, while an automation holding half of what its template named is
   * one whose every run loads half of it. So a copy that fails refuses the
   * whole write, and the client keeps the automation it had.
   *
   * The two ids are checked here, because one id naming two plugins is a
   * template nothing downstream can read - and a plugin with no id at all is
   * one no run could be told about.
   *
   * The copies answer with `release`, and every path this capture placed or
   * found already there is held back from `prune` until it is called. A
   * capture that throws has already let go of what it held, because there is
   * no write left to hand it to.
   */
  capture(client: string, plugins: TemplatePlugin[]): Promise<HeldCopies>;

  /**
   * Remember the copies a run session was handed, as host paths.
   *
   * A run reads its plugins where they are, for as long as it is going, and
   * nobody is connected to serve them again - so a copy one was handed is not
   * this host's to take away while that run lasts. What `prune` removes, this
   * holds back.
   */
  spare(paths: readonly string[]): void;

  /**
   * Remove every copy that no automation names any more.
   *
   * `kept` is what the automations this host holds still reference, as host
   * paths. Everything else under the copies' own directory goes, so an
   * automation somebody removed, or one whose template stopped naming a
   * plugin, does not leave its copy on the disk for ever - except a copy a run
   * session was handed, which `spare` keeps, and one a capture is still
   * holding, which no write names yet.
   *
   * A copy that will not go is left where it is rather than thrown on: this
   * runs beside a write that has already been made.
   */
  prune(kept: readonly string[]): void;
}
