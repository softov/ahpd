/** An agent backend, and everything the host asks one for. */

import type { Turn } from '@microsoft/agent-host-protocol';
import type { Bag } from './common.js';
import type { WireTurn } from './wire.js';
import type { Emit, Session, SubagentChat, SubagentRequest } from './session.js';
import type { ToolDefinition } from '@microsoft/agent-host-protocol';
import type { Offered } from './probe.js';
import type { ResourceStore } from './resources.js';
import type { StartTerminals } from './terminals.js';
import type { RunClientTool, ToolsChanged, ToolsEndpoint } from '../toolserver.js';
import type { ComputerPort } from './computers.js';
import type { MachineNeed } from './machine.js';

/**
 * An MCP server the host offers its agents, reached over stdio.
 *
 * `command` is what the agent starts and `args` what it is given; `cwd` and
 * `env` are its own directory and its own environment.
 */
export interface StdioMcpServer {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/**
 * An MCP server the host offers its agents, reached over HTTP.
 *
 * `url` is where it answers and `headers` go with every call, which is how an
 * endpoint that wants a bearer token is reached.
 */
export interface HttpMcpServer {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

/**
 * One MCP server, in one of the two shapes there are.
 *
 * A `stdio` and an `http` server are reached in ways with nothing in common
 * past the name a person gave one, and the two are kept apart rather than a
 * single object with the fields of both on it.
 */
export type McpServer = StdioMcpServer | HttpMcpServer;

/**
 * What running a tool does to the world.
 *
 * The contribution's own claim rather than a guarantee, and every flag is
 * optional because a tool that says nothing is a tool as it always was. What
 * reads it is a policy: a backend that runs the tool decides what to ask a
 * person about, and `destructive` is the flag the default asks on.
 */
export interface ToolEffects {
  /** It reads something. */
  reads?: boolean;
  /** It changes something. */
  writes?: boolean;
  /** It reaches the network. */
  network?: boolean;
  /** It can destroy something, so a person is asked before it runs by default. */
  destructive?: boolean;
}

/**
 * A tool the host contributes, with the session it was contributed to
 * already bound.
 *
 * The host's `HostTool` takes a `ToolCall` saying where it was called from;
 * by the time a backend sees one that is answered, so what is left is a
 * definition to offer the model and a function to call.
 */
export interface BoundTool {
  /** What the model is offered. `name` is the id it calls. */
  definition: ToolDefinition;
  /**
   * What running it does. Absent for a tool a client runs - see `owner`.
   */
  run?(input: Record<string, unknown>): Promise<string> | string;
  /**
   * What running it does to the world, carried from the `HostTool` that
   * contributed it. A backend reads this to decide whether to ask a person.
   */
  effects?: ToolEffects;
  /**
   * The client that runs this one, when it is a client's rather than the host's.
   *
   * A client announces what it provides on `SessionActiveClient.tools`, and
   * the protocol makes that client responsible for executing the call and
   * dispatching its result. So there is nothing to run here: the backend
   * offers the tool to the model, reports the call against that client, and
   * waits for it to say what happened.
   */
  owner?: string;
  /**
   * Whether the harness may defer this tool behind tool search.
   *
   * The host's `HostTool.deferLoading`, carried here so a backend does not have
   * to read it off the published definition - which never holds it. Undefined
   * means the harness's own default applies.
   */
  deferLoading?: boolean;
}

/**
 * One session a backend already has, before the host has named it.
 *
 * Deliberately not a `Summary`: the resource URI, the provider and the status
 * bits are the host's to decide - `IsRead` and `IsArchived` in particular are
 * kept per client and a backend has never heard of them.
 */
export interface Listed {
  /** The backend's own id for it. The host serves it as `<provider>:/<id>`. */
  id: string;
  /** Display title. */
  title: string;
  /** ISO 8601 timestamp of creation. */
  createdAt: string;
  /** ISO 8601 timestamp of the last change. */
  modifiedAt: string;
  /** Directories the agent has tool access to, as `file://` URIs. */
  workingDirectories: string[];
}

/** How the host asks a backend to start a session. */
export interface Start {
  /** The session channel URI the client chose. */
  uri: string;
  /** The chat channel URI beneath it. */
  chatUri: string;
  /** Config values in force, by key: this agent's defaults with the client's on top. */
  settings: Record<string, unknown>;
  /**
   * The directory the client asked the agent to work in, if it named one.
   *
   * A path, not a `file://` URI. Absent means the client named none and the
   * backend picks. A backend that will not work there should throw saying so:
   * a directory accepted and then ignored is a session running somewhere
   * nobody asked for, and nothing on screen says which.
   */
  workingDirectory?: string;
  /** Directories beside it the agent may also work in. */
  additional?: string[];
  /**
   * Whether one folder is one the person who started this session trusts.
   *
   * The host answers it for any folder, the session's own included, because
   * that is the question a backend asks before it loads something a project
   * carries: a `CLAUDE.md`, a settings file, a `.mcp.json`, a plugin - the
   * things a folder can make an agent do without anybody having read them. The
   * host is the only thing that knows the answer, because trust arrives from a
   * window on a connection and never from the folder.
   *
   * Absent is "the host said nothing", and a backend must read that as
   * untrusted: a folder whose trust nobody stated is a folder nobody vouched
   * for - decision `a-folder-is-untrusted-until-a-client-says-otherwise`.
   */
  trusted?: (folder: string) => boolean;
  /**
   * Tools the host contributes to this session, for the backend to offer.
   *
   * The host's own, not this backend's: a backend that cannot take tools from
   * anywhere ignores them, and the host still reports them on the session so
   * a client knows they exist.
   */
  tools?: BoundTool[];
  /**
   * The MCP servers this session's agent is offered, by the name a person gave
   * them.
   *
   * The host's own servers, over the ones this session's client plugins
   * contribute - a plugin's server of the same name wins, because the client
   * that asked for it is closer to the work than the host is. Left out when the
   * host is configured with none and no client plugin adds one, which is a
   * backend that is asked for nothing rather than one asked for an empty list.
   *
   * A backend that cannot take MCP servers ignores them: this host's own
   * backends reach the same servers through their own configuration, and an
   * agent that speaks ACP is handed the list on its `session/new` instead.
   */
  mcpServers?: Record<string, McpServer>;
  /**
   * What the host wants the model told, beside the backend's own prompt.
   *
   * One entry per host tool that carries an instruction. A backend that can
   * add to its system prompt adds these; one that cannot offers the tools on
   * their descriptions alone.
   */
  instructions?: string[];
  /**
   * The host's files, for a backend that reads or writes one itself.
   *
   * The same store the resource commands are served from, handed down rather
   * than reached for, so a backend reads the bytes a client would rather than
   * opening the filesystem a second time. This host serves any `file:` URI a
   * client asks for, so the store is no more reach than a client already has.
   * Left out when the host holds no store, and a backend that is not offered
   * one must expect to do without.
   */
  resources?: ResourceStore;
  /**
   * The host's shells, for a backend that runs a command itself.
   *
   * A factory, not the raw port, because a terminal is a channel and the host
   * owns it: the URI, the registration on the root list and the emit that
   * routes an action to that channel are all the host's, and a backend that
   * reached for the port got none of them. The same machinery serves the
   * composer's `!` command, so a shell a backend opens is one a client can
   * watch and one the session catalogues. Left out when the host holds no
   * terminal store, and a backend that is not offered one must expect to do
   * without.
   */
  terminals?: StartTerminals;
  /**
   * The host's tools, as an MCP server this session's backend may point its
   * own client at.
   *
   * A factory and not a server object, because the endpoint is per session: a
   * path and a bearer token of this session's own, opened on the host's own
   * listener and closed when the session ends. A backend that already calls
   * `tools` in process does not ask for this, and a host with nothing to serve
   * on - a daemon over stdio - leaves it off entirely.
   *
   * Answers `undefined` when no endpoint can be opened, which is what a host
   * that holds no listener to serve one on says.
   *
   * `runClient` is this backend's way of running a client's tool, for a backend
   * whose client reaches the host's tools through this server rather than in
   * process: a `tools/call` for a tool with an `owner` goes there instead of
   * being refused. `toolsChanged` is what it wants done when the session's tools
   * move - `notify` for a `list_changed` on an open stream, `list` to leave it
   * to the next `tools/list` - and leaving it out is `list`.
   */
  toolsServer?(options?: { runClient?: RunClientTool; toolsChanged?: ToolsChanged }): ToolsEndpoint | undefined;
  /**
   * How long this host lets one of a session's client calls wait.
   *
   * A backend holding a call a client runs needs a limit, because the turn is
   * blocked on it and a client that has gone quiet without going away would
   * hang it for ever. Handed rather than assumed so a deployment can say, and
   * already resolved: the host's own ten minutes when it was given nothing,
   * and zero for no limit at all, which is what a deployment that would rather
   * wait than cut a slow client off asks for.
   */
  clientToolTimeoutMs: number;
  /**
   * How to run a process in a machine, when the host holds a computer plugin.
   *
   * Absent on a host with no `computer:` provider. A backend that was asked to
   * run in a machine and is handed nothing must refuse rather than run on the
   * host - decision `a-backend-reaches-a-computer-through-a-port`.
   */
  computers?: ComputerPort;
  /** The config schema to report on the session channel. This agent's own. */
  schema(): Bag;
  /** What to report as customizations until the backend reports its own. */
  seedCustomizations?: Bag[];
  /**
   * What this backend's variant offers, so a session opened with a stored
   * model can say whether it is one this variant serves.
   *
   * Seeded beside the customizations because it answers the same question: a
   * session that is running will say its own models, and one that is not has
   * nothing to say them from except this.
   */
  seedModels?: { id: string; name: string }[];
  /** Where state actions go. The host routes them to the right channel. */
  emit: Emit;
  /**
   * Ask the host for a read-only chat for one of this backend's tool calls.
   *
   * A worker the harness runs inside a tool call is a conversation of its own,
   * and the host is the only thing that knows what a chat URI looks like and
   * what a chat's row says. The backend names the call and the words; the host
   * mints the URI, announces the row, opens the turn with the prompt, links
   * the call to it and hands back an emitter for that chat. The first call for
   * a tool call id is the one that opens it, and a second returns the same
   * chat without announcing it again.
   *
   * Optional. Without it, a backend draws a worker's output inline in the
   * turn that spawned it.
   */
  subagent?(toolCallId: string, request: SubagentRequest): SubagentChat;
  /** A session of this backend's to continue, rather than starting a new one. */
  resume?: string;
  /** The prompt to resume *at*, so a fork leaves the turns after it behind. */
  forkAt?: string;
  /**
   * The chain entry to resume *at*, keeping the id the session already had.
   *
   * A truncation rather than a fork: the turns after that point are dropped
   * and the conversation carries on as itself, which is what `chat/truncated`
   * asks for.
   */
  rewindAt?: string;
  /** Context the first turn carries to the backend without showing it. */
  context?: string;
  /** Turns already known, so a resumed session does not open empty. */
  seed?: Bag[];
  /**
   * A file a tool is about to change, and the same file once it has.
   *
   * Optional both ways: a backend that cannot see its own tools does not call
   * it, and a host with no changeset source does not pass one.
   *
   * A promise is returned where the host has a filesystem to read, so a
   * `before` is waited for: the write that follows it truncates the file the
   * read is of.
   */
  onFileEdit?(turnId: string, path: string, phase: 'before' | 'after', text?: string): Promise<void> | void;
  /**
   * A turn this backend has written under an id of its own.
   *
   * The host names a turn when a client sends one, and what this host keeps
   * against that turn, such as its sender, is what a later read asks for. A backend whose own record names turns its own way, as Claude's
   * transcript names every turn by the CLI's uuid, is asked again for what it
   * wrote them down as, so the host keeps the same record under that id too
   * rather than having to learn the backend's format.
   *
   * Optional both ways, like `onFileEdit`: a backend whose transcript keeps the
   * ids it was given never calls it, and a backend that never called it has a
   * turn that is only findable by the id the client sent.
   */
  onTurnRecorded?(turnId: string, transcriptId: string): void;
  /** Called once the backend has reported what it can do. */
  onHandshake?(): void;
  /**
   * Tokens for this backend's protected resources, by resource identifier.
   *
   * Only resources this agent advertised, and only what the connection
   * asking for the session pushed - authentication is per connection, so a
   * token one client offered is never spent on another's session. Absent for
   * a session nobody asked for: an automation firing at nine in the morning
   * has no connection behind it and runs on the daemon's own credentials.
   *
   * What to *do* with one is the backend's business. The host knows a token
   * belongs to a resource and nothing else about it.
   */
  credentials?: Record<string, string>;
}

/**
 * A worker chat a backend read back out of its own record.
 *
 * The counterpart of `Start.subagent` for a session that already happened:
 * the harness wrote the worker's conversation down beside the session's own,
 * and this is what is left to rebuild its chat from. The tool call it was
 * spawned by is the link; the host mints the chat URI from the two because
 * only the host knows what one looks like.
 */
export interface RestoredSubagent {
  /** The spawning call, in the chat below or in another worker's chat. */
  toolCallId: string;
  /** The chat the call is in, when it is not the session's own. */
  parentToolCallId?: string;
  /** What the chat is called in a list. */
  title: string;
  /** The harness's own name for the kind of worker, when it said one. */
  agentName?: string;
  /** One line about the work. */
  description?: string;
  /** The worker's own conversation, in the protocol's shape. */
  turns: Bag[];
}

/**
 * A backend the host can run sessions on.
 *
 * One host serves several. `provider` is what a client names in
 * `createSession` and what every session of this kind reports, so it has to
 * be unique across the agents a host was given.
 *
 * Everything but `provider`, `displayName`, `schema`, `defaults` and `create`
 * is optional, and what is left out is a real answer rather than a gap: a
 * backend with no `list` has no sessions to browse, one with no `probe`
 * offers no models and no commands until a session of its own reports them.
 */
export interface Agent {
  /** The id clients name. Unique among a host's agents. */
  provider: string;
  /** What a person reads instead of the id. */
  displayName: string;
  /** One line about what this backend is. */
  description?: string;

  /**
   * What a second chat in one session can be made from.
   *
   * Multi-chat itself is the host's doing - a second chat is `create` called
   * twice - but these two are the backend's: a fork continues a conversation
   * from one of its turns, and a side chat starts a fresh one that knows what
   * a turn elsewhere said. A backend that declares neither still gets several
   * chats; it just cannot be asked to make one out of another.
   */
  chats?: { fork?: boolean; sideChat?: boolean };

  /**
   * Whether a session of this backend can work in more than one directory.
   *
   * The first is the process root and never moves; the rest are its peers.
   * A backend that leaves this out gets one directory per session, which is
   * what a client is told when the capability is absent.
   */
  multipleDirectories?: boolean;

  /**
   * OAuth protected resources this backend can be given a token for.
   *
   * RFC 9728 metadata, served on `AgentInfo.protectedResources`, and the only
   * thing that makes `authenticate` callable: the protocol says a client's
   * `resource` MUST match one the server has itself advertised, so a host that
   * advertises none can be sent no token at all.
   *
   * `required: false` on an entry is a backend saying it works without one -
   * this daemon runs as whoever started it and inherits their credentials, so
   * a token is an override rather than a precondition.
   */
  protectedResources?: Bag[];

  /**
   * What a session of this kind can be told to do differently.
   *
   * A JSON-Schema-shaped `{ properties }`. Each property may carry `title`,
   * `description`, `enum`, `enumLabels`, `enumDescriptions`, `default`,
   * `sessionMutable` and `scope`.
   *
   * The last two are what the *host* reads, and they are the only two things
   * it needs to know about a key it otherwise knows nothing about.
   * `sessionMutable: false` is refused on a running session rather than
   * accepted and dropped. `scope` is `'session'` - the default - for a key the
   * chats of one session share, and `'chat'` for one each chat answers for
   * itself: a permission mode is the session's, and a model is the chat's.
   * `scope` is this library's, not the protocol's, whose config schema is
   * deliberately generic and says nothing about either.
   *
   * Everything else is between the backend and whatever client draws it.
   *
   * One schema, used before a session exists and by every session that does.
   * Two copies drift, and a composer then offers one set of controls on the
   * new-session screen and a different set the moment a session opens.
   */
  schema(): Bag;
  /** What each schema key sits at when nothing has been chosen. */
  defaults(): Record<string, unknown>;

  /**
   * What this agent needs from the host for a machine to run it.
   *
   * Read when a machine is made for this agent, never at load, so an agent
   * registered after the plugin that makes machines still declares them -
   * decision `an-agent-declares-its-machine-needs-with-a-method`. Each entry is
   * named by this backend and delivered as a mount, an environment variable or
   * a copy-in; the machine's runtime turns the resolved needs into its own
   * flags. A backend that needs nothing of the host leaves it out, which is
   * every backend that runs against the host's own filesystem.
   *
   * The paths are the host's, not the machine's: `target` is where one lands
   * inside, and a `~` in a value is expanded when the machine is made.
   */
  machine?(): Record<string, MachineNeed>;

  /**
   * Whether a session in a machine runs in a host started inside it.
   *
   * A backend that cannot move its own process - cofold's loop, tools and
   * shell all run in this process - answers `true` here, and the host gives a
   * session that names a computer a session of the SDK's proxy backend
   * instead of this one: a whole `ahpd` with this backend loaded is started
   * inside the machine, and its actions are carried out as the session's -
   * decision `a-cofold-session-in-a-computer-runs-in-a-nested-host`.
   *
   * Absent or `false` is a backend that must refuse a computer it cannot
   * enter, which is what every backend did before this existed. A backend
   * that spawns through the `computers` port itself - `@ahpd/agent-acp` is
   * one - leaves this out too, because its own process is already in there.
   */
  runsNested?: boolean;

  /**
   * Whether this agent was registered from a preset: one of several agents a
   * plugin builds out of one backend, each under its own id with its own
   * endpoint, keys or command.
   *
   * A host started inside a machine loads the plugin with its defaults, so it
   * serves the plugin's own agent and none of the presets. The proxy lets that
   * agent stand in for one that is not a variant - a built-in, or a default
   * renamed by an option - and ends a variant's session with a sentence
   * instead, since running it as the plain agent would use the wrong endpoint
   * and keys. Absent is not a variant.
   */
  variant?: boolean;

  /**
   * What the backend offers, asked once at startup.
   *
   * Before any session exists, because that is when a client asks: the models
   * to pick from and the commands behind a slash are what a composer needs to
   * draw itself, and waiting for the first session means offering them only
   * once the conversation has started.
   */
  probe?(): Promise<Offered>;

  /**
   * The directories this backend will work in.
   *
   * The host's answer to "may this client read that file": a resource outside
   * every backend's directories is refused, because a host that served the
   * whole filesystem is one that anybody who can reach the port can read
   * `~/.ssh` through.
   *
   * Left out means this backend claims no directories, and contributes
   * nothing to what may be browsed.
   */
  directories?(): string[];

  /** Sessions this backend already has. Ordering is the host's business. */
  list?(): Promise<Listed[]>;

  /**
   * This backend's row for one session, read without listing the rest.
   *
   * What a client opening a row the host does not hold costs without it: a
   * link from another machine, a session written to disk after the last
   * listing. `list` answers that by reading every transcript on the machine,
   * for one id - and on a machine with a few thousand of them that is the
   * difference between a window opening and a window waiting.
   *
   * `id` is the one the host holds a session under, which is the id in the row
   * `list` would have answered, and `undefined` is a real answer: this backend
   * has no such session. Left out is a backend whose store cannot be asked
   * about one session, and the host falls back to listing for it.
   */
  find?(id: string): Promise<Listed | undefined>;

  /**
   * Remove this backend's own copy of a session, and nothing else.
   *
   * What makes a delete a delete: without it the host forgets a session and
   * the next listing offers it again, so a client is told a thing is gone and
   * finds it in the same list a moment later. `id` is this backend's id for
   * the session and `directory` the one it ran in, the pair `list` answered the
   * row with.
   *
   * Called after a running session's backend has stopped, never while one
   * still writes the transcript it keeps, and for a row the daemon only lists
   * as well as one it is holding.
   *
   * `directory` is what `list` answered that row with, and `undefined` is a
   * real answer: cofold's `list` carries no workspace for a session that ran
   * nowhere. A backend that needs the folder answers with every project
   * directory rather than the daemon's own cwd - which is what the Claude SDK
   * does when `dir` is left out, the same scope its `list` reads.
   *
   * Resolving means the copy is gone or was never there: a session deleted
   * twice is deleted, and a store that has nothing for the id is not a
   * failure. Anything else rejects, and the client is told - a delete that
   * silently failed is the bug this exists for.
   *
   * Left out is a backend whose store cannot delete, which the host says once
   * per provider rather than refusing the delete over: refusing would leave a
   * running session nobody can close.
   *
   * Spelled as it may also be `undefined` because a backend whose ability to
   * delete is the server's answer rather than its own spells it as a getter
   * over that answer: ACP's server advertises `session/delete` in its
   * handshake, which nothing has read when the agent is built. A getter is the
   * only shape that can be absent now and present after the first listing, and
   * the host reads this property once per delete, so what it finds is the
   * answer as of then.
   */
  delete?: ((id: string, directory: string | undefined) => Promise<void>) | undefined;

  /**
   * Where this backend keeps its own record of a session, if it keeps one.
   *
   * What the window's "open session state file" opens and what a "collect
   * logs" request copies in beside the host's own. `id` is this backend's id
   * for the session and `directory` the one it ran in; undefined means there
   * is no such file, which is a real answer for a backend that writes none.
   */
  stateFile?(id: string, directory: string): string | undefined;

  /**
   * Endpoints worth probing when the network is in question.
   *
   * Listed on the window's network diagnostics, which fetches each and
   * compares the status with `expectedStatus` (200 when absent) and the body
   * with `expectedContent`. A backend that reaches nothing lists none.
   */
  endpoints?(): Endpoint[];

  /**
   * One past session's turns, read without starting anything.
   *
   * What makes a catalogue row openable: the host serves it from here, and
   * starts nothing until somebody sends a turn to it. Undefined means this
   * backend has no such session.
   *
   * A `WireTurn` rather than a `Bag[]`: everything around the parts is checked
   * here, and each part is checked where it is built - a part is assembled by
   * mutation as an agent talks, so the literal is what can be held to a shape
   * and the variable after it cannot. This was a `Bag[]`, and inside it a
   * rebuilt transcript wrote a tool-call `status` that is not one of the
   * seven, left off three fields the completed state requires, and gave its
   * content blocks no `type`.
   */
  transcript?(id: string): Promise<WireTurn<Turn>[] | undefined>;

  /**
   * The worker chats one past session holds, read without starting anything.
   *
   * What makes a restored session's worker chats openable again: the host
   * serves each of them read-only from here, and lists them on the session's
   * catalogue with the tool call that spawned each as the origin. Undefined
   * means this backend keeps no such record, which is a real answer.
   *
   * `turns` is the session's own transcript, which the host has already read
   * to serve the chat: handed over so a backend that needs it to resolve a
   * worker's link does not read the same file a second time.
   */
  subagents?(id: string, turns?: WireTurn<Turn>[]): Promise<RestoredSubagent[] | undefined>;

  /** Start one. */
  create(start: Start): Session;
}

/** One endpoint a backend suggests probing. */
export interface Endpoint {
  name: string;
  url: string;
  /** The status a probe treats as success; 200 when left off. */
  expectedStatus?: number;
  /** Text the body is expected to carry, when it is read at all. */
  expectedContent?: string;
}
