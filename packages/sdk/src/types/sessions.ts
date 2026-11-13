import type { Scope } from '../usage/scopes.js';
import type { ChangesSummary } from './changes.js';
import type { Owner } from './usage.js';

/**
 * The pull requests a session's branch had when it started, and the ones it
 * has made its own since.
 *
 * An empty `initialPullRequestUrls` is a captured baseline and not an absent
 * one: it says the branch had none, which is a different answer from a host
 * that never asked. `associatedPullRequestUrls` is what the session took as
 * its own, most recent first. Both keep the spelling they arrived with.
 */
/** One session that runs in a host inside a machine, as the outer host lists it. */
export interface NestedRecord {
  /** The agent that runs it on this host. */
  provider: string;
  /** The machine's id, as in `computer://<id>`. */
  machine: string;
  /** The id the inner host holds the session under. */
  inner: string;
  /** The title a list shows. */
  title: string;
  /** When it was made, ISO 8601. */
  createdAt: string;
  /** When it last moved, ISO 8601. */
  modifiedAt: string;
  /** Its folders, as the URIs this host named. */
  workingDirectories: string[];
}

export interface PullRequestBaseline {
  initialPullRequestUrls: string[];
  associatedPullRequestUrls: string[];
}

/**
 * Where a session was sent from, as the window that sent it named it.
 *
 * `session` is the chat session the work was delegated from and `chat` the
 * exact chat inside it, both spelled the way the window spells a chat session.
 * `depth` is how far the work had already been delegated when it arrived,
 * which is what a later send on from here counts from.
 *
 * Kept because two readers need it after the window that sent it has gone: the
 * agent's turn is told where to report back to, and the window reads the origin
 * off the session's summary.
 */
export interface RemoteOrigin {
  session: string;
  chat: string;
  depth: number;
}

/**
 * What started a session, for one an automation began.
 *
 * The protocol calls this provenance durable: a session a run made outlives the
 * process that made it, and its summary names the automation and the run after
 * a restart as it did before one.
 */
export interface AutomationOrigin {
  kind: 'automation';
  automation: string;
  run: string;
}

/**
 * The worktree a session runs in, as this host made it.
 *
 * `base` is what the tree was cut from, and `branch` the branch made for the
 * session, absent where the session continued `base` rather than making one.
 * `commit` is the commit the tree was cut from, which is where the session's
 * work is counted from: a local base can be ahead of the remote, and a commit
 * that was already on it is not the session's work. Absent on a record written
 * before it was kept, which counts from the base's name as it did before.
 * Kept so a tree outlives the process that made it: a delete after a restart
 * still knows which tree to take, and an unarchive knows where to put it back.
 */
export interface StoredWorktree {
  repository: string;
  path: string;
  base: string;
  branch?: string;
  commit?: string;
}

/**
 * The session this one was made by, as the window recorded it.
 *
 * The id of the session, and optionally the chat and the turn inside it the
 * ask came from. Looser than an origin: this is a reference and not an
 * address, and nothing is reported back to it.
 */
export interface CreatedBy {
  session: string;
  chat?: string;
  turnId?: string;
}

/**
 * The multi-root workspace a session was made from, as the window that made
 * it recorded it: the URI of its workspace file. VS Code's
 * `ISessionMultiRootMetadata`, under `_meta.multiRoot`, which is what lets a
 * window add and remove the session's folders.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L1119-L1127
 */
export interface MultiRoot {
  workspaceFile: string;
}

/**
 * One chat of a session, as the store keeps it.
 *
 * A session is a container and a chat is a conversation in it, and what makes
 * a recorded chat rebuildable is the name its backend kept it under: a restart
 * starts each chat again with `resume` set to that. The URI is the chat's own
 * name on this host, `default` marks the one a client gets when it names none,
 * and `origin` is what it was made from, where a client made it out of another.
 * A chat closed rather than deleted is marked `closed`: its conversation is
 * still the backend's, and the record is what keeps it out of every list.
 */
export interface StoredChat {
  /** The chat's URI, as this host named it. */
  uri: string;
  /**
   * The id the backend keeps this conversation under.
   *
   * The session's own id for its first chat, and the chat's own id for every
   * other one - which is what `Start.chatId` names. Empty where the backend
   * has not said one, which is a chat nothing can be resumed from.
   */
  backendId: string;
  /**
   * The backend that serves this chat, where it is not the session's own.
   *
   * A session names one backend and every chat in it runs on that one, unless
   * a chat was opened on another - which a plugin or a tool names. The session
   * keeps its own provider either way; this is what a restart, a rewind and a
   * resize start the chat on, and what makes it a chat of another backend
   * rather than one of the session's. Absent where the chat is the session's
   * own, which is every chat this host opened before there was a choice.
   */
  provider?: string;
  /**
   * The config this chat runs on, where it is not the session's own.
   *
   * The settings a chat was opened with on a backend of its own, kept here
   * because the session's config is the session's - a key of the session's
   * backend is not a setting that chat's backend can read. It holds the keys
   * no backend owns as well, `computer` among them, since a chat in a machine
   * of its own has to be started back into it. Absent where the chat is the
   * session's own, whose config is the session's.
   */
  config?: Record<string, unknown>;
  /**
   * The values this chat set for itself, where it runs on its session's
   * backend: the properties the session's schema marks `chatMutable`, laid
   * over the session's config, as VS Code keeps a chat's own config values
   * with the chat. A chat is made with the ones its session's default chat
   * runs on, or the ones the chat it was forked from set, and a client's
   * `chat/configChanged` moves them. Absent where it set none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L340-L341
   */
  configValues?: Record<string, unknown>;
  /** The title it was given, or nothing where it was never named. */
  title?: string;
  /** What it was made from, as `session/chatAdded` carried it. */
  origin?: Record<string, unknown>;
  /** How a person may use it, where its maker said: `read-only` or `hidden`. Absent is `full`. */
  interactivity?: 'full' | 'read-only' | 'hidden';
  /** The opt-in host tools its maker asked for this chat alone, beside the session's. */
  tools?: string[];
  /** Whether this is the chat a client gets when it names none. */
  default?: boolean;
  /**
   * Whether the chat was closed and its conversation left where it is.
   *
   * A chat closed under `closedChats: 'hidden'`, which is the default: the
   * backend keeps the conversation and this host keeps claiming it, so it is
   * neither listed as a session of its own nor offered as a chat of its
   * session. The record is what carries the claim across a restart.
   */
  closed?: boolean;
  /**
   * The wake the agent asked this host for with `schedule_wakeup`: when it is
   * due, in milliseconds, and the prompt the turn it begins carries. One per
   * chat.
   *
   * `sender` is the person the turn the wake begins acts as, which is the
   * person the turn that set the wake was sent by. Kept here rather than asked
   * for when it fires, because the turn that set it is long over by then and
   * its sender is let go of when it ends - and the wake outlives the session
   * sleeping and the daemon restarting, which is what a record is for. Absent
   * where nobody set it, and the turn it starts then carries nobody: under a
   * users directory that turn may read and may not write.
   */
  wake?: { at: number; prompt: string; sender?: Owner };
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
 * `scope` is a third of the same kind: the team and project a session's work is
 * charged to, resolved from what the person asked and their memberships rather
 * than from a schema. It sits beside the session rather than in `config`,
 * because a backend is handed `config` when it resumes and has no idea what a
 * charge is.
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
   * What this session's work is charged to: `null` when it was decided that
   * nothing is (a host with no people or no teams, a root connection, a session
   * a clock started), `undefined` when nothing was decided yet.
   */
  scope(id: string): Scope | null | undefined;
  /**
   * Record the scope, `null` for charged to nothing, or forget it with `undefined`.
   *
   * The answer rather than the name that was chosen, because the answer is what
   * a later turn needs and a name would have to be resolved again by somebody
   * who is not there.
   */
  setScope(id: string, value: Scope | null | undefined): void;
  /**
   * Whose work this is, as a typed reference.
   *
   * `user:<id>` for the person who created it and `root:<host>` for a session
   * a root connection started. Undefined where nobody owns it: a host with no
   * users directory has no person to name, and neither has a session this host
   * began before it recorded one.
   */
  owner(id: string): Owner | undefined;
  /** Record it, or forget it with `undefined`. */
  setOwner(id: string, value: Owner | undefined): void;
  /**
   * Who sent one of this session's turns, as the same typed reference.
   *
   * Keyed by turn as well as by session because two people can be talking in
   * one session and only the turn says which of them it was. Undefined is the
   * answer for a turn nobody was recorded as having sent: one sent before this
   * was kept, and a worker's turn this host opened rather than a person asked.
   */
  sender(id: string, turnId: string): Owner | undefined;
  /** Record it, or forget it with `undefined`. */
  setSender(id: string, turnId: string, value: Owner | undefined): void;
  /**
   * Which harness this session runs on, or nothing where none was recorded.
   *
   * Two harnesses can read the same transcripts, so an id on its own says
   * neither whose a row is nor which endpoint resumes it. Only the host knows:
   * a transcript is written by whichever CLI answered, and says nothing about
   * the plugin that started it. Undefined for a session made before this was
   * recorded, and for one whose harness is not loaded - a listing falls back to
   * the first agent that lists it rather than dropping it.
   */
  provider(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setProvider(id: string, value: string | undefined): void;
  /**
   * The URI the host holds this session under, or nothing where none was kept.
   *
   * A session made today is `ahp-session:/<id>`, and one listed before that
   * change keeps its `<provider>:/<id>` name. The name is the host's to choose
   * and not the client's, so it is written down with the row rather than built
   * again from the row's provider: a restart publishes the name it was made
   * with, and an old session keeps the name its clients already hold.
   *
   * Optional: a store that leaves it out keeps no name, and a row it cannot
   * answer for is named from its provider as it was before this was kept.
   */
  uri?(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setUri?(id: string, value: string | undefined): void;
  /**
   * The opt-in host tools this session's request named, or nothing where it
   * named none.
   *
   * Kept with the session rather than read off the request each time, because
   * a request is one moment and a session outlives it: a session started again
   * - by a restart, by a resume - is offered the same tools it was started
   * with, without anybody repeating the list.
   *
   * Optional: a store that leaves it out offers no opt-in tool to any session.
   */
  tools?(id: string): string[] | undefined;
  /** Record them, or forget them with `undefined`. */
  setTools?(id: string, value: string[] | undefined): void;
  /**
   * The one folder this session was started trusted in, or nothing where no
   * request asked for trust.
   *
   * Kept beside the opt-in tool names and for the same reason: trust is asked
   * for once, by the request that started the session, and what it bought is
   * that the folder's project files are read. A session started again - by a
   * restart, by a resume - has no request to ask again, so the answer has to
   * live with the session. Only the folder named, never one under it.
   *
   * Optional: a store that leaves it out trusts no folder for any session.
   */
  trustedFolder?(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setTrustedFolder?(id: string, value: string | undefined): void;
  /**
   * Whether this session loads the settings of the person who runs the daemon,
   * where its request said `false`, and nothing where it left the default.
   *
   * Kept beside the trusted folder and for the same reason: the request is one
   * moment and the session outlives it. Absent is the default every session
   * has always had - its own person's settings load - so only the `false` a
   * request asked for is written down.
   *
   * Optional: a store that leaves it out loads them for every session.
   */
  userSettings?(id: string): boolean | undefined;
  /** Record it, or forget it with `undefined`. */
  setUserSettings?(id: string, value: boolean | undefined): void;
  /**
   * Whether this session is external: one a backend listed, made outside this
   * host, that this host opened and nobody has sent a turn in since, as VS
   * Code's registry keeps a discovered session external until it is adopted.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSessionRegistry.ts#L104-L122
   *
   * Kept with the session for the reason its provider is: opening it writes
   * the session's record, and a record is what makes a listed session this
   * host's own, so what opening it did not change has to be written beside
   * it. Only `true` is written down; a session this host made is never one.
   *
   * Optional: a store that leaves it out holds a session external while it
   * has no record here.
   */
  external?(id: string): boolean | undefined;
  /** Record it, or forget it with `false` or `undefined`. */
  setExternal?(id: string, value: boolean | undefined): void;
  /**
   * The session this one was started from, as the id that session is held
   * under, or nothing where nothing started it.
   *
   * Recorded when the `create` tool opens a session inside another one. Kept
   * with the rest of a session's record rather than in memory, because what
   * the link is for is telling the session that started a child when that
   * child ends, and a child can end long after the process that started it.
   *
   * The id rather than the URI, for the reason the whole store is keyed by id:
   * a scheme is only whose a session is, and a client may have named the same
   * session under another one.
   */
  parent?(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setParent?(id: string, value: string | undefined): void;
  /**
   * The session at the top of this one's tree, read from the parent links.
   *
   * A session nothing started is its own root, and a chain of sessions each
   * made inside the last ends at the one the first was made in. Optional, as
   * `parent` is: a store that keeps no links holds no tree, and every session
   * in it is a root of its own.
   */
  rootOf?(id: string): string;
  /**
   * How far under that root this session sits, in links, read the same way.
   *
   * Nothing started it and this is `0`, and a session the `create` tool made
   * inside another is one more than that one. Optional, as `rootOf` is.
   */
  depthOf?(id: string): number;
  /**
   * What this host knows of a session that runs in a host inside a machine,
   * or nothing for any other session.
   *
   * The transcript of a nested session is the inner host's, kept in the
   * machine, so no backend here lists it. This record is what lists it after a
   * restart and what a resume starts from, without asking the machine.
   * Optional: a store without it lists no nested session after a restart.
   */
  nested?(id: string): NestedRecord | undefined;
  /** Record it, or forget it with `undefined`. */
  setNested?(id: string, value: NestedRecord | undefined): void;
  /** Every nested session recorded, by id. */
  nestedSessions?(): [string, NestedRecord][];
  /**
   * Every session recorded with a folder, by id, and the folder it ran in.
   *
   * A backend lists the paths it serves and nothing else, so a session that
   * ran elsewhere - a bot's own folder, a git worktree - is one no listing has
   * offered. A listing reads this to ask each backend about those sessions by
   * id, with the folder the record names. Optional: a store without it lists
   * no such session after a restart, and a session whose record names no
   * folder is not one here.
   */
  recordedFolders?(): [string, string][];
  /**
   * Where this session was sent from, or nothing for a session this host
   * began itself.
   *
   * Kept with the rest of a session's record rather than in memory, because a
   * session sent from another window outlives the process that took it and
   * the window reads the origin back off its summary.
   *
   * Optional: a store without it takes every session as one of its own.
   */
  remoteOrigin?(id: string): RemoteOrigin | undefined;
  /** Record it, or forget it with `undefined`. */
  setRemoteOrigin?(id: string, value: RemoteOrigin | undefined): void;
  /**
   * The worktree this host made for the session, or nothing for a session
   * that runs in a folder somebody chose.
   *
   * Optional: a store without it forgets every tree when the host stops.
   */
  worktree?(id: string): StoredWorktree | undefined;
  /** Record it, or forget it with `undefined`. */
  setWorktree?(id: string, value: StoredWorktree | undefined): void;
  /**
   * The other worktrees the session keeps: each tree it worked in before a
   * move took it to another folder, kept on disk as the session's, and
   * archived, put back and removed with it, as VS Code's host keeps a moved
   * session's worktree among its additional worktrees.
   *
   * Optional: a store without it holds none, and a tree a move left stays on
   * disk with nothing to remove it.
   */
  additionalWorktrees?(id: string): StoredWorktree[];
  /** Record them, or forget them with an empty list. */
  setAdditionalWorktrees?(id: string, value: StoredWorktree[]): void;
  /**
   * When the host archived this session itself, because its pull requests
   * were merged, as an ISO time. Nothing for a session a person archived, and
   * for one that is not archived.
   *
   * Optional: a store without it never has a session the host may delete.
   */
  autoArchivedAt?(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setAutoArchivedAt?(id: string, value: string | undefined): void;
  /**
   * The session this one was made by, as a window recorded it, or nothing.
   *
   * Beside the origin rather than part of it: a session is made by another
   * session whether or not it was sent from another window, and the window
   * reads the two under two keys.
   */
  createdBy?(id: string): CreatedBy | undefined;
  /** Record it, or forget it with `undefined`. */
  setCreatedBy?(id: string, value: CreatedBy | undefined): void;
  /**
   * What started this session, for one an automation began, or nothing.
   *
   * Kept with the rest of a session's record rather than in memory, because a
   * session a run made outlives the process that made it and a summary read
   * after a restart names the automation and the run.
   *
   * Optional: a store without it takes every session as one a person began.
   */
  automationOrigin?(id: string): AutomationOrigin | undefined;
  /** Record it, or forget it with `undefined`. */
  setAutomationOrigin?(id: string, value: AutomationOrigin | undefined): void;
  /**
   * The multi-root workspace the session was made from, as the window that
   * made it recorded it, or nothing.
   *
   * Optional: a store without it holds none, and a window's folder changes
   * are then refused for every session.
   */
  multiRoot?(id: string): MultiRoot | undefined;
  /** Record it, or forget it with `undefined`. */
  setMultiRoot?(id: string, value: MultiRoot | undefined): void;
  /**
   * The folder this session works in, as a path, or nothing where none was
   * recorded.
   *
   * What a backend is told when it is asked to find or read the session, so a
   * session that ran outside the paths it serves - a subfolder, a worktree, a
   * bot's own folder - is looked for where it ran. Optional: a store without it
   * leaves every backend to look in the paths it serves.
   */
  workingDirectory?(id: string): string | undefined;
  /** Record it, or forget it with `undefined`. */
  setWorkingDirectory?(id: string, value: string | undefined): void;
  /**
   * What this session's own work added and removed, or nothing where it was
   * never read.
   *
   * The counts a catalogue row carries, which are the session's and not its
   * directory's: two sessions in one folder did different work, and a commit
   * takes neither of them to nothing. Reading them takes git - they are a
   * difference between two of the session's own checkpoints - so they are read
   * where they move rather than where a row is built, and kept here because
   * the row of a session this host is not running has nowhere else to read
   * them from.
   *
   * Nothing is not zero: a session nothing has been read for falls back to
   * what its directory says, and a session that was read and did nothing is
   * one the host has an answer for.
   */
  changes(id: string): ChangesSummary | undefined;
  /** Record it, or forget it with `undefined`. */
  setChanges(id: string, value: ChangesSummary | undefined): void;
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
   * Where this session's attachments are kept, or nothing where this store
   * keeps no files.
   *
   * A client pastes a picture and the host writes the bytes here before the
   * message they belong to is applied, so what travels from then on is the
   * path.
   * The store answers rather than the host because the store is what owns the
   * directory a session's own file is written in, and a folder beside it is
   * the same decision made again.
   *
   * Optional: a store that keeps nothing answers nothing, and every message
   * goes on exactly as it arrived. A store that answers is a store whose
   * `forget` removes the folder with the session, since a folder holding the
   * bytes of a session that is gone is a folder nothing will ever read.
   */
  attachmentsDir?(id: string): string | undefined;
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
   * The title the session was given, or nothing where it was never named.
   *
   * Kept beside its default chat's own, as VS Code's host keeps a session's
   * custom title beside each chat's: a session renamed while it has other
   * chats takes the title, and its default chat keeps the one it holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionTitle/sessionTitleContribution.ts#L74-L78
   */
  customTitle?(id: string): string | undefined;
  /** Set it. An empty string is the session having none of its own. */
  setCustomTitle?(id: string, value: string): void;
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
   * The client flags in force for one chat, or `0` where none were ever set.
   *
   * A chat carries the same two bits a session does, and they are its own: a
   * session is a container for conversations and a person reads one of them
   * without the others. Keyed by the chat URI for the reason a chat's title
   * is, so the bit belongs to that chat and not to the session it sits in -
   * and a worker's chat, which no `Session` holds, still has one.
   */
  chatFlags(id: string, chatUri: string): number;
  /** Replace them. The whole bitset, because that is what the protocol sends. */
  setChatFlags(id: string, chatUri: string, value: number): void;
  /**
   * What one chat's own work added and removed, or nothing where none was
   * read for it: the counts its entry in the session's catalogue carries, as
   * VS Code's host keeps each listed chat's aggregate in its session's record.
   * Kept by chat URI for the reason a chat's title is, and kept at all because
   * a session this host is not running lists its chats with them. Optional: a
   * store without it keeps no chat's counts, and its chats carry none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1810-L1828
   */
  chatChanges?(id: string, chatUri: string): ChangesSummary | undefined;
  /** Record it, or forget it with `undefined`. */
  setChatChanges?(id: string, chatUri: string, value: ChangesSummary | undefined): void;
  /**
   * The draft typed into one chat, the `Message` its client last sent, or
   * nothing. Kept by chat URI for the reason a chat's title is, so a draft
   * outlives the process and comes back when the chat opens, as VS Code's
   * host keeps a chat's draft.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/chatDraft/chatDraftContribution.ts#L14-L68
   */
  chatDraft?(id: string, chatUri: string): Record<string, unknown> | undefined;
  /** Replace it. Nothing forgets it, which is a draft cleared. */
  setChatDraft?(id: string, chatUri: string, draft: Record<string, unknown> | undefined): void;
  /**
   * What clients marked on the session, the annotations channel's state as
   * its reducer left it, or nothing. Kept so the marks outlive the process,
   * as VS Code's host keeps a session's annotations in its own record.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10936-L10963
   */
  annotations?(id: string): Record<string, unknown> | undefined;
  /** Record it, or forget it with `undefined`. */
  setAnnotations?(id: string, value: Record<string, unknown> | undefined): void;
  /**
   * The chats this session has, in the order they were opened.
   *
   * A session is a container for conversations, and this is what makes a
   * restart rebuild them rather than only the first: `setChats` is called when
   * one is opened or closed, and every chat on the list is started again with
   * the backend id it was written under.
   *
   * Empty for a session this store never heard of, as `flags` answers `0`.
   */
  chats(id: string): StoredChat[];
  /** Replace them. Empty forgets them, which is a session with no chat left. */
  setChats(id: string, list: StoredChat[]): void;
  /**
   * Move one chat from one session to another, in one write.
   *
   * A chat's own record travels with it: its title, its entry on the source's
   * chat list and its place on the destination's. `turns` names the turns the
   * store must carry too, because it cannot find them itself - a sender is kept
   * per session and turn, and every chat of a session writes into the same map,
   * so which of those turns are the moved chat's is only known to the caller.
   *
   * Both ids are session ids, as everywhere in this store. A chat the source
   * does not hold is not an error here: the caller has already read it.
   */
  moveChat(from: string, to: string, uri: string, turns: string[]): void;
  /**
   * The ids of the sessions this store holds.
   *
   * Every other question here is about a session the caller can already name,
   * and a host that is starting cannot: a peer chat's URI carries no session,
   * so which session owns one is read from what the store recorded - and the
   * store is what says which sessions there are to read. The order is a
   * store's own, since every caller here is looking for a chat.
   *
   * A session nothing was ever recorded for is not one this store holds, which
   * is the same answer `flags` gives with `0`.
   */
  sessions(): string[];
  /**
   * Forget a session entirely.
   *
   * Called when one is disposed. Without it a store that survives restarts is
   * a file that only ever grows, carrying flags for sessions that went months
   * ago.
   */
  forget(id: string): void;
  /**
   * Forget every session `gone` says is gone, and keep the rest.
   *
   * Called after a catalogue listing that every backend answered. A session no
   * backend lists any more is a transcript deleted outside this host, and what
   * is kept for it - an archived bit, a chat's title - is for a row nothing can
   * open again.
   *
   * Asked per id rather than handed a list, because the answer is the host's
   * and only the host has it: whether a listing covered this row at all. A row
   * whose directory and provider no listing has named is one nothing looked
   * for, and `gone` says no.
   *
   * Optional, and a store that keeps nothing has nothing to prune. A store that
   * does not implement it keeps everything, which is the answer of a host
   * embedded in something that owns its own copies.
   */
  prune?(gone: (id: string) => boolean): void;
  /**
   * Write what is waiting to be written, and nothing after.
   *
   * Called when the host closes, so a successor reading the same file is its
   * only writer. Optional: a store that keeps nothing has nothing to finish.
   */
  close?(): void;
}
