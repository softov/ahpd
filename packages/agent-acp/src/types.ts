/**
 * The shapes this package exports.
 *
 * The agent's options, the connection's, and the per-turn state a
 * `session/update` is mapped through. Nothing here imports a runtime value, so
 * the contract can be read without spawning anything.
 */

import type {
  AuthenticateRequest,
  AuthenticateResponse,
  ContentBlock,
  CreateTerminalRequest,
  CreateTerminalResponse,
  InitializeResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  SetSessionModeRequest,
  SetSessionModeResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  ToolCallStatus,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { Bag, MessageFrom, SecretRef, Seed, ToolsChanged } from '@ahpd/sdk';

/**
 * What a machine needs for one agent to run in it, as the agent declares it.
 *
 * `env` is set in the machine and never in a spawn on this host: a value is the
 * variable's own, or `{ "$secret": "<name>" }`, which whatever makes the machine
 * reads for the machine's owner when it makes it. A plugin option written
 * `{ "fromEnv": "<VAR>" }` is the daemon's value of that variable by the time it
 * is here. `copy` is each host path copied in, `~` at its start being the host
 * user's home.
 */
export interface AcpMachine {
  /** Variables set inside the machine, by name. */
  env?: Record<string, string | SecretRef>;
  /** Host paths copied into the machine, each to an absolute path there. */
  copy?: { source: string; target: string }[];
  /** The part the agent's CLI comes from, by its id in the host's versions file. */
  part?: string;
  /** The directory inside the machine the agent keeps its configuration in, as a state volume. */
  state?: string;
  /** The host files and directories that state directory is seeded from; never a login file. */
  seed?: Seed[];
}

/** What an embedder, or a plugin's options, may set. */
export interface AcpOptions {
  /** The program to spawn as the ACP server. */
  command: string;
  /** The arguments to give it. */
  args?: string[];
  /** Environment variables merged over `process.env` for the child. */
  env?: Record<string, string>;
  /** The directory the server runs in; the session's working directory when absent. */
  cwd?: string;
  /** The AHP provider id. Default `acp`. */
  provider?: string;
  /** What a client reads instead of the id. Default `ACP`. */
  displayName?: string;
  /** Whether this agent was registered from a preset, as `Agent.variant` says. */
  variant?: boolean;
  /** One line about what this backend is. */
  description?: string;
  /** The model id a session that names none runs on. */
  model?: string;
  /**
   * The sign-in to send after the handshake, for a server that refuses a
   * session until one has happened.
   *
   * `methodId` is the server's own id out of the `authMethods` its handshake
   * listed. The bridge never picks one itself: a wrong guess signs a person in
   * as whoever that guess was, and the sign-in that ran is not one anybody can
   * undo through this host.
   */
  authenticate?: { methodId: string; _meta?: Record<string, unknown> };
  /**
   * The sign-in to send instead for a session placed in a machine.
   *
   * A machine is given the preset's `machine.env` as well, so a shipped row
   * whose variable only the machine has signs in there and nowhere else.
   * Absent, a session in a machine sends `authenticate`.
   */
  authenticateInMachine?: AcpOptions['authenticate'];
  /**
   * Whether the host's own tools are offered to each session as an MCP server.
   *
   * On by default, which is the case the bridge exists for: an ACP agent
   * reaches the host's files, terminals and sessions through its client, and
   * the tools are the rest of what a session can see from outside itself. A
   * deployment whose ACP servers would rather not have them says `false`.
   */
  hostTools?: boolean;
  /**
   * Whether this agent asks before it loads a project's own configuration.
   *
   * ACP carries no trust field and this host reads none of a project's files
   * for an ACP agent, so a session in a folder the host did not vouch for is
   * refused rather than handed a folder nobody has read - decision
   * `a-folder-is-untrusted-until-a-client-says-otherwise`. `true` is a preset
   * saying its agent asks on its own, which is what makes the folder its
   * business rather than this host's.
   */
  honoursTrust?: boolean;
  /**
   * How a session's agent hears that the tools it listed are not the ones there are.
   *
   * `notify` is the stream this host holds open and a
   * `notifications/tools/list_changed` down it, which is what an agent that
   * watches for one needs; `list` is nothing said, and the change left to the
   * agent's next `tools/list`. Both serve the current list either way, so
   * `notify` is the default: an agent that ignores the notification is no worse
   * off than one that was never told, and one that watches is saved a re-list
   * it would otherwise never make.
   */
  toolsChanged?: ToolsChanged;
  /**
   * Where a session says what it left out or had to invent.
   *
   * A server left out of its MCP list, and a `tools/call` the agent reported no
   * call for and this bridge therefore names itself.
   */
  log?: (line: string) => void;
  /**
   * What a machine needs to run this agent, which `machine()` answers.
   *
   * Absent, the agent declares nothing and a machine for it carries only what
   * its profile does.
   */
  machine?: AcpMachine;
}

/**
 * What a session answers a permission request with.
 *
 * The option the person chose, or `cancelled` when nobody could be asked or
 * when the server offered no option this bridge may select.
 */
export type PermissionAnswer = { optionId: string } | 'cancelled';

/**
 * One choice offered on a call awaiting confirmation, in the shape of the
 * protocol's `ConfirmationOption`.
 *
 * `id` is the server's own `optionId`, which is what a client sends back as
 * `selectedOptionId`; `group` is 1 for approvals and 2 for refusals.
 */
export interface ConfirmationOption {
  id: string;
  label: string;
  kind: 'approve' | 'deny';
  group: number;
}

/**
 * What a session answers for the server.
 *
 * `update` is the only one always wired. Everything else is optional and each
 * is present only when the session has what the request needs - a file read
 * needs the host's store, a terminal needs the host's factory - and what is
 * absent is left off the handshake, so a server is never told a client can do
 * something it cannot.
 */
export interface AcpHandlers {
  update(sessionId: string, update: SessionUpdate): void;
  /** Read a file the agent named, through the host's own store. */
  readTextFile?(request: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  /** Write one. */
  writeTextFile?(request: WriteTextFileRequest): Promise<WriteTextFileResponse>;
  /** Open a shell the host owns and lists. */
  createTerminal?(request: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  /** Everything it has printed so far. */
  terminalOutput?(request: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  /** Wait for it to exit. */
  waitForTerminalExit?(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
  /** End it. */
  killTerminal?(request: KillTerminalRequest): Promise<KillTerminalResponse>;
  /** Let go of it. */
  releaseTerminal?(request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse>;
  /**
   * A permission the server is waiting on, put to a person.
   *
   * Absent means nobody is asked and every request is cancelled, which is the
   * honest answer rather than one that allows silently.
   */
  permission?(request: RequestPermissionRequest): Promise<PermissionAnswer>;
}

/** How a connection spawns a server and where its updates go. */
export interface AcpConnectionOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  handlers: AcpHandlers;
}

/** One open ACP connection over a server's stdio. */
export interface AcpConnection {
  /**
   * The handshake, which is where the server says what it can do.
   *
   * Asks once and answers the held reply on a second call, because a server is
   * told what a client can do at the start of a connection and never again.
   */
  initialize(): Promise<InitializeResponse>;
  /**
   * Sign in with one of the methods the handshake listed.
   *
   * Sent once per connection, between `initialize` and `session/new`, because
   * that is where a server that refuses a session until it is signed in takes
   * it.
   */
  authenticate(request: AuthenticateRequest): Promise<AuthenticateResponse>;
  /** Open one session on the server, which names it. */
  newSession(request: NewSessionRequest): Promise<NewSessionResponse>;
  /** Reopen a session the server already has, which replays its history. */
  loadSession(request: LoadSessionRequest): Promise<LoadSessionResponse>;
  /** The sessions the server holds, when it advertises a catalogue. */
  listSessions(request: ListSessionsRequest): Promise<ListSessionsResponse>;
  /** Put the session into one of the server's modes. */
  setSessionMode(request: SetSessionModeRequest): Promise<SetSessionModeResponse>;
  /** Set one of the server's own session config options. */
  setSessionConfigOption(request: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse>;
  /**
   * Point the session at a model by the call the protocol used before options.
   *
   * `session/set_model` is gone from the SDK, so it goes out as a method named
   * rather than as a typed one, and only a session talking to a server that
   * named no model option ever sends it.
   */
  setModel(request: { sessionId: string; modelId: string }): Promise<unknown>;
  /**
   * Send one prompt and wait for the turn to stop.
   *
   * The blocks are what the session decided the server can take, which is the
   * handshake's business rather than this connection's.
   */
  prompt(sessionId: string, prompt: ContentBlock[]): Promise<PromptResponse>;
  /** The ACP cancel notification, which asks the server to stop a running prompt. */
  cancel(sessionId: string): Promise<void>;
  /**
   * Ask the server to close a session and free whatever it holds for it.
   *
   * Only a server whose handshake advertised `session.close` can be asked; the
   * session decides that, not the connection.
   */
  closeSession(sessionId: string): Promise<void>;
  /**
   * Ask the server to delete a session and everything it holds of it.
   *
   * Only a server whose handshake advertised `sessionCapabilities.delete` can be
   * asked; the catalogue decides that, not the connection. It is a different
   * request from `closeSession`, which frees what the server has in memory and
   * leaves the conversation on disk.
   */
  deleteSession(sessionId: string): Promise<void>;
  /**
   * Settles with why the server process is gone: it never started, or it exited.
   *
   * Every call made on a connection whose server is gone rejects with the same
   * reason.
   */
  readonly ended: Promise<Error>;
  /**
   * The last of what the server wrote on stderr, for a failure to carry.
   *
   * Nothing surfaces it while the server runs: a healthy server's chatter is
   * the server's, and a client is told about it only when it died. Settles once
   * a dead server's last words have been read off the pipe.
   */
  stderrTail(): Promise<string>;
  /** End the subprocess; settles once it has gone, and never rejects. */
  close(): Promise<void>;
}

/** One tool call the server opened, as the mapping remembers it between updates. */
export interface AcpCall {
  /** The server's own id for the call, which every action names. */
  toolCallId: string;
  /** The programmatic name, when the server gave one, and its title otherwise. */
  toolName: string;
  /** What a client draws instead of the name. */
  displayName: string;
  /** Whether `chat/toolCallReady` has gone out for it. */
  readied: boolean;
  /**
   * Whether a person is being asked about this call.
   *
   * A question has its own ready, and a ready behind it carrying `not-needed`
   * would say the question is not there.
   */
  asked: boolean;
  /** The arguments the server has given it, as the JSON a client reads. */
  input?: string;
  /**
   * The last status the server gave it, of any.
   *
   * A call carries no status at all on some updates, and one carries `pending`
   * for as long as the agent has not started it, so this is what tells a call
   * the agent has begun from one it is only holding.
   */
  status?: ToolCallStatus;
  /**
   * When the first update about this call arrived, as epoch milliseconds.
   *
   * ACP carries no time of its own, so this is the receive time on this
   * plugin's clock. A call whose row a permission request opened has none until
   * its first update says anything about it.
   */
  startedAt?: number;
  /**
   * The client whose tool this call is for, when the agent reached one.
   *
   * Read off what the agent reported - see `AcpTurn.ownerOf` - and never set on
   * a call that is the agent's own, the host's, or one nobody's tool matches.
   */
  owner?: string;
}

/**
 * What the mapping needs from the session, which a replayed turn has none of.
 *
 * The transcript rebuilds a turn by running this same mapping over updates the
 * server sent once, with nothing behind it: no directories to judge a path
 * against and no changeset to record one in. Absent rather than a pair of
 * functions that record nothing, so a replay says so by having none.
 */
export interface AcpReach {
  /** Whether a path is one of the session's own directories. */
  within(path: string): boolean;
  /**
   * A file this turn changed, so the host can hold both sides of it.
   *
   * `before` is what the file held when the agent said it changed it, which no
   * `file://` URI can name afterwards. Absent, and the host reads what it can
   * reach - a file the agent created has no before to hold.
   */
  changed(path: string, before?: string): void;
}

/**
 * One turn's mapping state, mutated as updates arrive.
 *
 * A turn starts with no part. The mapping opens a markdown or reasoning part
 * at the first chunk of a run of that kind, so `parts` holds the turn's
 * response parts in the order the server wrote them, held for a snapshot.
 */
export interface AcpTurn {
  /** The turn the client began. */
  turnId: string;
  /** Every response part this turn holds, shared with the session's snapshot. */
  parts: Bag[];
  /** The whitespace a run of message chunks has written before its part opened. */
  waiting?: string;
  /** Tool calls this turn opened, by the server's own id. */
  calls: Map<string, AcpCall>;
  /** The session behind this turn, absent on one the transcript replays. */
  reach?: AcpReach;
  /**
   * The session's cumulative cost when this turn opened, which what the turn
   * spent is the change from.
   *
   * ACP reports a cost for the whole session rather than for a turn, and no
   * cost at all before the first `usage_update`, so a turn with no baseline
   * counts from zero rather than from a number nobody gave it.
   */
  costAtStart?: number;
  /** The session's cumulative cost as of the last `usage_update` this turn read. */
  cost?: { amount: number; currency: string };
  /** Whether `session/prompt` has been sent; a cost reported before it is no turn's. */
  prompted?: boolean;
  /** What the last `usage_update` said, which is what this turn holds. */
  usage?: Bag;
  /**
   * Which client's tool a call the agent reported is for, if any.
   *
   * The agent reaches a client's tool through the host's own MCP server, so it
   * names the call the way that server spells the tool, or says it in the title
   * when it names nothing. A turn the transcript replays has no session behind
   * it and no lookup: a call with no owner is one nobody's tool matched.
   */
  ownerOf?(name: string | undefined, title: string): string | undefined;
  /**
   * A call this turn has started, which somebody is to run.
   *
   * Called where the ready says the call is running, and before that ready goes
   * out, so the entry that asks a client for the call exists before the chat
   * says the call has started.
   */
  onRunning?(call: AcpCall): void;
}

/**
 * One turn this process watched, as the catalogue reads it back.
 *
 * The updates are kept raw rather than as the parts they built, because the
 * transcript is a second rendering of the same notifications: replaying them
 * through the one mapping is what stops a rebuilt conversation from disagreeing
 * with the live one.
 */
export interface WatchedTurn {
  /** The turn the client began. */
  turnId: string;
  /** ISO 8601 timestamp, taken from the action the turn began with. */
  startedAt: string;
  /** What began the turn, as the transcript reports it. */
  message: { text: string; origin?: MessageFrom['origin'] };
  /** How it ended, once it has. */
  state: 'complete' | 'cancelled' | 'error';
  /** How long it took, in milliseconds, once it has ended. */
  duration?: number;
  /**
   * What the turn last said it had spent, once it has ended.
   *
   * Kept rather than left to the updates: a cost is reported for the whole
   * session, so what a turn spent is the share it took from the total it
   * opened with - a number the updates carry only against a turn that was
   * there to be counted.
   */
  usage?: Bag;
  /**
   * Every update the server sent while this turn ran, each with the time it
   * was received.
   *
   * The time is absent on the updates a `session/load` replayed: they carry no
   * time of their own and the replay's own would be wrong.
   */
  updates: { update: SessionUpdate; at?: number }[];
}

/**
 * One ACP session this process watched.
 *
 * The ACP server owns the conversation and `loadSession` is how it is read
 * back, so this is not a second store: it is what a catalogue row needs to open
 * onto something, kept for the life of the process and dropped when the process
 * is.
 */
export interface WatchedSession {
  /** The provider id this bridge registered, which keys the catalogue. */
  provider: string;
  /** The server's own session id. */
  id: string;
  /** The directory it was opened in. */
  cwd: string;
  /** Directories beside it, as paths rather than URIs. */
  additional: string[];
  /** The title the session reports, which is the first thing said until one is set. */
  title: string;
  /** ISO 8601 timestamp of the first time this process watched it. */
  createdAt: string;
  /** ISO 8601 timestamp of the last update this process watched. */
  modifiedAt: string;
  /** Every turn this process watched, in the order they ran. */
  turns: WatchedTurn[];
}
