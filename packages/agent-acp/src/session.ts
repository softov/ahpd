/**
 * One ACP session, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, one spawned ACP server behind a turn, and the translation of
 * that server's notifications into the `chat/*` actions a client already
 * knows. The update-to-action decisions themselves live in `mapping.ts`; this
 * file is the lifecycle around them, and the connection in `connection.ts`.
 *
 * Rules the protocol requires of anything emitting chat actions, kept here the
 * way the other backends keep them:
 *
 * - `chat/turnStarted` comes first, then a response part is opened, and only
 *   then may a delta stream into it.
 * - The running turn is `active` and is not in `turns`; it moves there when it
 *   completes.
 * - A turn carries both sides: `message.text` is what was said and
 *   `responseParts` is what the agent answered.
 *
 * A member this task cannot honestly support - a fork, a rewind, a live config
 * swap, a permission question - is left out or answered with the empty answer
 * the interface documents. Nothing throws over a capability this bridge does
 * not have yet.
 */

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RequestError } from '@agentclientprotocol/sdk';
import type {
  AgentCapabilities,
  AvailableCommand,
  BlobResourceContents,
  ContentBlock,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  McpServer as AcpMcpServer,
  PermissionOptionKind,
  PromptCapabilities,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
  StopReason,
  TerminalOutputRequest,
  TerminalOutputResponse,
  TextResourceContents,
  Usage,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import { callTimes, machineAsked, Status, withCallTimes } from '@ahpd/sdk';
import type { Bag, Chosen, MessageAttachment, MessageFrom, OpenedTerminal, Ran, Session, Spawn, Start, ToolsEndpoint } from '@ahpd/sdk';
import { watchSession } from './catalog.js';
import { connectAcp } from './connection.js';
import { closePlan, confirmationOptions, mapUpdate } from './mapping.js';
import type { AcpConnection, AcpOptions, AcpTurn, ConfirmationOption, PermissionAnswer, WatchedSession, WatchedTurn } from './types.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The title a session carries until somebody says something. */
const UNTITLED = 'ACP session';

/**
 * What each stop reason that is not an answer says, by name.
 *
 * `end_turn` is absent because it is the server saying it is done and the turn is
 * what the client asked for. The other three are the server saying it stopped
 * early, and a turn that stopped early is not an answer: the model ran out of
 * room, the session used up the requests it was allowed, or the agent declined.
 *
 * A reason absent here - `end_turn`, and anything a later version of the
 * protocol names and this bridge has not heard of - ends the turn complete,
 * because a stop this code cannot describe is better read as an answer than
 * reported as a failure with no reason.
 */
const NOT_AN_ANSWER: Partial<Record<StopReason, string>> = {
  max_tokens: 'The agent ran out of tokens before it answered',
  max_turn_requests: 'The agent used every turn request this session allowed',
  refusal: 'The agent declined to answer this prompt',
};

/**
 * Whether the handshake advertised something ACP writes as an empty object.
 *
 * `session/close`, `sessionCapabilities.additionalDirectories` and every entry
 * of `promptCapabilities` are advertised this way, so what is read is whether
 * the key is there at all rather than what it says - the same way
 * `catalog.ts` reads the server's own catalogue.
 */
const advertised = <T>(capability: T | null | undefined): boolean =>
  capability !== undefined && capability !== null;

/**
 * Whether an attachment carries its bytes with it, which is what an inline one
 * is.
 *
 * The protocol writes its variants as a `const enum`, whose members name
 * themselves as strings but narrow nothing at runtime, so the words the
 * protocol declares are what these test for.
 */
const inline = (one: MessageAttachment): one is Extract<MessageAttachment, { data: string }> =>
  (one as { type: string }).type === 'embeddedResource';

/** Whether an attachment is a reference to a resource rather than bytes. */
const referencing = (one: MessageAttachment): one is Extract<MessageAttachment, { uri: string }> =>
  (one as { type: string }).type === 'resource';

/**
 * How long a server is given to answer `session/close` before the connection
 * goes anyway.
 *
 * The answer is what says the server let go of the session, so a close that did
 * not wait would kill a process half way through releasing it.
 */
const CLOSE_GRACE_MS = 1000;

/**
 * One host server as `session/new` names it.
 *
 * ACP spells an HTTP server as a URL and a list of headers rather than as the
 * map of headers VS Code's key holds, so the token goes over as the one header
 * it is: `ahp` is the name the in-process server carries, and a server that
 * already has one by that name is being told about the same tools twice.
 */
const HOST_TOOLS = 'ahp';

/**
 * The MCP servers a session is opened with, in ACP's shape.
 *
 * The host's own map, less whatever the handshake says this server cannot take,
 * plus the host's tools as one HTTP server when `hostTools` is on. A server left
 * out is said rather than dropped, because a deployment that configured a
 * server and watches a session not reach it has no other way to find out.
 */
const serversFor = (
  start: Start,
  own: () => ToolsEndpoint | undefined,
  capabilities: AgentCapabilities | undefined,
  hostTools: boolean,
  say: (line: string) => void,
): AcpMcpServer[] => {
  const taken: AcpMcpServer[] = [];
  const mcp = capabilities?.mcpCapabilities;
  for (const [name, one] of Object.entries(start.mcpServers ?? {})) {
    // ACP has one shape per transport and this host has two, so a stdio server
    // is a name, a command and a list of variables, and an HTTP one is a name,
    // a URL and a list of headers.
    if (one.type === 'http') {
      if (mcp?.http !== true) {
        say(`${name}: this ACP server takes no MCP server over HTTP, so it was left out`);
        continue;
      }
      taken.push({
        type: 'http',
        name,
        url: one.url,
        headers: Object.entries(one.headers ?? {}).map(([header, value]) => ({ name: header, value })),
      });
      continue;
    }
    // ACP cannot say where a stdio server starts, so a directory goes with it
    // and is not sent. Said rather than dropped, like every server left out.
    if (one.cwd !== undefined) {
      say(`${name}: ACP carries no directory for a stdio MCP server, so ${one.cwd} was left out`);
    }
    taken.push({
      name,
      command: one.command,
      args: one.args ?? [],
      env: Object.entries(one.env ?? {}).map(([variable, value]) => ({ name: variable, value })),
    });
  }
  if (!hostTools || start.toolsServer === undefined) return taken;
  // The host's own tools are one HTTP server among the rest, so a server that
  // takes none over HTTP is not told about this one either.
  if (mcp?.http !== true) {
    say(`${HOST_TOOLS}: this ACP server takes no MCP server over HTTP, so it was left out`);
    return taken;
  }
  const endpoint = own();
  if (endpoint === undefined) return taken;
  taken.push({
    type: 'http',
    name: HOST_TOOLS,
    url: endpoint.url,
    headers: [{ name: 'authorization', value: `Bearer ${endpoint.token}` }],
  });
  return taken;
};

/**
 * The JSON-RPC code the protocol's `auth_required` carries, read off the SDK
 * rather than written out, because a code this file recognises by hand is a
 * code it stops recognising if the protocol moves it.
 */
const AUTH_REQUIRED = RequestError.authRequired().code;

/**
 * One conversation over one ACP server.
 *
 * `options` is the backend's identity and wiring; `start` is what this
 * particular session was told. The server is spawned lazily, on the first
 * turn, so a session somebody opened and never used costs no subprocess.
 */
export function acpSession(options: AcpOptions, start: Start): Session {
  const provider = options.provider ?? 'acp';
  const emit = start.emit;
  /*
   * The directory the server works in.
   *
   * The client's choice wins, then the package's, then the daemon's own: a
   * session resumed or continued in another directory is where the client said
   * it is, and a server that was pointed somewhere says so on `session/new`.
   */
  const where = start.workingDirectory ?? options.cwd ?? process.cwd();

  /**
   * Whether a path is one this session was given to work in.
   *
   * Both sides are resolved first, so a path that climbs out of a directory
   * with `..` is judged by where it lands rather than by how it was written.
   */
  const directories = [where, ...(start.additional ?? [])].map((one) => resolve(one));
  const inside = (path: string): boolean => {
    const full = resolve(path);
    return directories.some((dir) => full === dir || full.startsWith(`${dir}/`));
  };

  /**
   * The host's own tools, as the one HTTP server this session hands its agent.
   *
   * Asked for once and kept: the endpoint answers with a token of its own, and
   * a server that dies is opened again with the same endpoint, so asking per
   * open would leave the process behind the first one answering for a session
   * nothing is listening to.
   */
  let endpoint: ToolsEndpoint | undefined;
  let asked = false;
  const toolsServer = (): ToolsEndpoint | undefined => {
    if (!asked) {
      endpoint = start.toolsServer?.();
      asked = true;
    }
    return endpoint;
  };

  /** The config in force, by key. `session/configChanged` merges into this. */
  const settings: Record<string, unknown> = { ...start.settings };
  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  /** What the host offered until the server reports its own. */
  const seeds: Bag[] = [...(start.seedCustomizations ?? [])];
  /** The commands the server last advertised, as customizations. */
  let commands: Bag[] = [];
  /**
   * The modes the server named, once it has.
   *
   * ACP only names them on `session/new` and `session/load`, so a session that
   * has not opened yet cannot honestly report an enum for them; the agent's
   * own schema carries the property without one.
   */
  let modes: SessionModeState | undefined;
  /**
   * The session config options the server named, once it has.
   *
   * This is where a model choice lives in ACP: the option whose category is
   * `model`, with the values the server serves. The bridge does not invent one,
   * so a session that has not opened answers no models.
   */
  let offers: SessionConfigOption[] = [];
  /**
   * The models a server from before config options named, where it named none.
   *
   * Those servers answered `session/new` with a `models` field rather than with
   * a model option. The SDK's types no longer carry it, so it is read off the
   * answer as it stands; it is only read when there is no option, because an
   * option is the newer account of the same thing.
   */
  let listedModels: { id: string; name: string }[] | undefined;
  let active: Bag | undefined;
  /** The running turn's mapping, so an update knows what it belongs to. */
  let mapping: AcpTurn | undefined;
  /**
   * The session's cumulative cost as of the last `usage_update` read, which is
   * what the next turn counts from.
   *
   * ACP reports a cost for the whole session rather than for a turn, so a turn
   * can only be told what it spent by the change since it opened.
   */
  let cumulative: number | undefined;
  /** The connection this session spawned, once it has one. */
  let live: AcpConnection | undefined;
  /** The server's own id for this conversation, once `session/new` answered. */
  let acpSessionId: string | undefined;
  /** Whether the server said it can be asked to close that conversation. */
  let closes = false;
  /** What the server said it can take in a prompt, once the handshake has said it. */
  let takes: PromptCapabilities | undefined;
  /** Whether the server said it can be given directories beside the one it runs in. */
  let extras = false;
  /**
   * The ids the server offered for sign-in, kept from the handshake.
   *
   * A server names them once, at the start of a connection, and an error that
   * arrives later has to name them itself: the sentence that says which way
   * to sign in is the whole of what a person is given.
   */
  let signIns: string[] = [];
  /**
   * The updates a server replayed while this session was opening.
   *
   * A `session/load` answers with the whole conversation before its response,
   * and those updates are earlier turns rather than part of whichever turn
   * happened to ask for the server.
   */
  const replay: SessionUpdate[] = [];
  /** Whether the session is opening, so an update it sends is replay. */
  let loading = false;
  /** The one opening, shared by every caller, so one server is spawned. */
  let opening: Promise<{ connection: AcpConnection; sessionId: string }> | undefined;
  /** Whether a client asked to stop, read when the prompt settles. */
  let cancelRequested = false;
  let closed = false;
  /** Why the last turn failed, or nothing. Cleared when a turn starts. */
  let failed: string | undefined;
  /** What it is doing, or nothing while it is idle. */
  let activity: string | undefined;
  let title = UNTITLED;
  /**
   * Whether a person named this session themselves.
   *
   * An agent may call a conversation what it likes until somebody says
   * otherwise; after that the name is theirs, and the agent's next idea for it
   * is read as nothing to do.
   */
  let renamed = false;
  let modified = new Date().toISOString();
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  const queued: Bag[] = [];
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;
  /** The catalogue's record of this session, once the server has named it. */
  let record: WatchedSession | undefined;
  /** The turn being watched, while one runs. Kept for the transcript. */
  let watchedTurn: WatchedTurn | undefined;
  /**
   * The permissions the server is waiting on a person for, by tool call id.
   *
   * Held because the ACP request is answered from here: `confirm` settles the
   * promise the request is awaiting, which is what sends the reply back.
   */
  const permissions = new Map<string, {
    /** The input-needed entry id a client answers by. */
    requestId: string;
    /** The option an approval with no option picked selects, when the server offered a once option. */
    allow?: string;
    /** The option a refusal with no option picked selects, when it offered a once option. */
    reject?: string;
    /** Every option the server offered, as the call offers them to a person. */
    offered: ConfirmationOption[];
    settle(answer: PermissionAnswer): void;
  }>();
  /** The terminals this session opened for the server, by the server's own id. */
  const terminals = new Map<string, { handle: OpenedTerminal; limit?: number }>();

  const messageOf = (why: unknown): string => (why instanceof Error ? why.message : String(why));

  const touch = (): void => {
    modified = new Date().toISOString();
    if (record !== undefined) record.modifiedAt = modified;
  };

  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /**
   * `SessionStatus`: 8 is in progress, 4 waits on a person and 1 is idle.
   *
   * A permission the server is blocked on is the session waiting for
   * somebody, which is what a client draws the input request from.
   */
  const status = (): number => (permissions.size > 0 ? Status.InputNeeded
    : active !== undefined ? Status.InProgress
      : failed !== undefined ? Status.Error
        : Status.Idle);

  /** Remember the modes the server named, and where it currently sits. */
  const learnModes = (state: SessionModeState | null | undefined): void => {
    if (state === null || state === undefined) return;
    modes = { ...state };
    settings.permissionMode = state.currentModeId;
  };

  /** The option a model choice is set through, when the server named one. */
  const modelOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    offers.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'model');

  /** The option a mode choice is set through, where the server names one. */
  const modeOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    offers.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'mode');

  /**
   * The key an option's value is kept under.
   *
   * A `mode` option is the newer account of the same thing the legacy modes
   * carry, so it is where `permissionMode` is read from, and a `model` option
   * is the model. Every other option is a control of its own, under the
   * server's own id: the ids belong to the server and the other keys belong to
   * the host, so the two are kept apart by a prefix.
   */
  const keyOf = (option: SessionConfigOption): string => {
    if (option.type === 'select' && option.category === 'model') return 'model';
    if (option.type === 'select' && option.category === 'mode') return 'permissionMode';
    return `acp.${option.id}`;
  };

  /**
   * The options that are controls of their own, rather than the model or the mode.
   *
   * Only the two kinds a control can draw: what the protocol carries is a
   * choice of values or a switch, and a server naming anything else has named
   * something this bridge cannot put in front of a person.
   */
  const controlOptions = (): SessionConfigOption[] =>
    offers.filter((one) => (one.type === 'select' || one.type === 'boolean')
      && keyOf(one) !== 'model' && keyOf(one) !== 'permissionMode');

  /**
   * Remember the session config options the server named, and where each stands.
   *
   * A value learned this way is written down and not said out: the client that
   * asked for the session reads it out of `config.values` rather than being
   * told what it asked about.
   */
  const learnOffers = (list: SessionConfigOption[] | null | undefined): void => {
    if (list === null || list === undefined) return;
    offers = [...list];
    for (const option of offers) settings[keyOf(option)] = option.currentValue;
  };

  /**
   * The models a server from before config options named, kept.
   *
   * Those servers answered `session/new` with a `models` field of their own
   * rather than with a model option, and the SDK's types no longer carry it, so
   * it is read off the answer as it stands. An option wins: where a server
   * names both, the option is the newer account of the same thing, and reading
   * the older one as well would give a client two answers to one question.
   */
  const learnModels = (answer: unknown): void => {
    if (modelOption() !== undefined) return;
    const named = bag(answer).models;
    const held = bag(named).availableModels;
    if (!Array.isArray(held)) return;
    listedModels = held
      .filter((one): one is { modelId: string; name: string } => typeof bag(one).modelId === 'string')
      .map((one) => ({ id: one.modelId, name: typeof one.name === 'string' ? one.name : one.modelId }));
    const current = bag(named).currentModelId;
    if (typeof current === 'string') settings.model = current;
  };

  /**
   * One value the agent moved, said to every client and kept as the one in force.
   *
   * Said only when it is not the value already in force: a server may repeat an
   * update it has already made, and a client told the same thing twice has to
   * work out whether anything moved. This is the only place `session/configChanged`
   * goes out, so that what a client hears and what `settings()` answers cannot drift.
   */
  const configChanged = (key: string, value: unknown): void => {
    if (settings[key] === value) return;
    settings[key] = value;
    emit('session', { type: 'session/configChanged', config: { [key]: value } });
  };

  /**
   * What an update's options say, said to every client.
   *
   * Said against the values in force before the update was learned, so an
   * option the server repeated is not said again - the whole list arrives on
   * every update, and only what moved is news.
   */
  const offersChanged = (list: SessionConfigOption[]): void => {
    for (const option of list) configChanged(keyOf(option), option.currentValue);
  };

  /** A select's values, flattening any groups into the flat list a picker draws. */
  const choicesOf = (option: SessionConfigOption & { type: 'select' }): { value: string; name: string }[] => {
    const choices: { value: string; name: string }[] = [];
    for (const entry of option.options) {
      if ('group' in entry) {
        for (const leaf of entry.options) choices.push({ value: leaf.value, name: leaf.name });
      }
      else choices.push({ value: entry.value, name: entry.name });
    }
    return choices;
  };

  /**
   * One command the server offers, as the customization a client draws.
   *
   * ACP commands are the slash surface, which is a prompt leaf rather than a
   * file: there is no path behind one, so the URI names the command itself
   * rather than pretending a file exists. The input hint is carried as an
   * argument hint, which is what a composer puts beside the name.
   */
  const commandLeaf = (command: AvailableCommand): Bag => ({
    type: 'prompt',
    id: `command:${command.name}`,
    name: command.name,
    uri: `acp-command:${provider}/${command.name}`,
    enabled: true,
    ...(command.description === '' ? {} : { description: command.description }),
    ...(command.input === null || command.input === undefined ? {} : { argumentHint: command.input.hint }),
  });

  /**
   * One option, as the control a client draws.
   *
   * A select carries the values the server serves as its enum and their names
   * as the labels, which is the only place either can come from, and the value
   * in force as the default, so a client that never asked still draws it where
   * the agent left it.
   */
  const optionControl = (option: SessionConfigOption): Bag => {
    const choices = option.type === 'select' ? choicesOf(option) : [];
    return {
      scope: 'session',
      type: option.type === 'boolean' ? 'boolean' : 'string',
      title: option.name,
      ...(option.description === null || option.description === undefined ? {} : { description: option.description }),
      sessionMutable: true,
      ...(option.type === 'boolean'
        ? { default: option.currentValue }
        : {
            enum: choices.map((one) => one.value),
            enumLabels: choices.map((one) => one.name),
            default: option.currentValue,
          }),
    };
  };

  /**
   * The schema this session reports, with what the server named.
   *
   * The agent's own schema carries `permissionMode` without an `enum`, because
   * no server has been asked yet. A session that has asked fills it in - from
   * the `mode` option where the server named one, and from the legacy modes
   * where it did not, which is the only place either can come from - and adds
   * every other option as a control of its own under `acp.<id>`.
   */
  const schemaOf = (): Bag => {
    const base = bag(start.schema());
    const properties = bag(base.properties);
    const mode = modeOption();
    const approvals = mode === undefined
      ? modes === undefined ? undefined : {
        enum: modes.availableModes.map((one) => one.id),
        enumLabels: modes.availableModes.map((one) => one.name),
        default: modes.currentModeId,
      }
      : {
        enum: choicesOf(mode).map((one) => one.value),
        enumLabels: choicesOf(mode).map((one) => one.name),
        default: mode.currentValue,
      };
    const controls = controlOptions().map((one) => [keyOf(one), optionControl(one)] as const);
    if (approvals === undefined && controls.length === 0) return base;
    return {
      ...base,
      properties: {
        ...properties,
        ...(approvals === undefined ? {} : { permissionMode: { ...bag(properties.permissionMode), ...approvals } }),
        ...Object.fromEntries(controls),
      },
    };
  };

  /**
   * One server notification, into the running turn and the session's own state.
   *
   * A connection is per session, so an update for another session id is not
   * this conversation's; it is dropped rather than written into the wrong turn.
   * A mode, a config or a command update moves the session whether or not a
   * turn is running, because the server may say so at any time and a client
   * draws them from the session's state.
   */
  const receivedUpdate = (sessionId: string, update: SessionUpdate): void => {
    if (closed) return;
    if (acpSessionId !== undefined && sessionId !== acpSessionId) return;
    /*
     * When this arrived, which is what a tool call's start and end are: ACP
     * carries no time of its own, so the times are the ones this plugin read
     * the updates at. Taken once, so every use of it is the same moment.
     */
    const at = Date.now();

    if (update.sessionUpdate === 'session_info_update') {
      const said = update.title;
      /*
       * The agent's name for the conversation, which replaces the one derived
       * from the first prompt. Not said twice, and not said at all once a
       * person has named the session themselves: a title a client is told
       * twice is a title it has to reconcile, and a name somebody chose is not
       * the agent's to replace.
       */
      if (typeof said === 'string' && said !== '' && !renamed && said !== title) {
        title = said;
        if (record !== undefined) record.title = said;
        emit('session', { type: 'session/titleChanged', title: said });
        touch();
      }
      return;
    }

    if (update.sessionUpdate === 'current_mode_update') {
      if (modes !== undefined) modes = { ...modes, currentModeId: update.currentModeId };
      configChanged('permissionMode', update.currentModeId);
      touch();
      return;
    }
    if (update.sessionUpdate === 'config_option_update') {
      offersChanged(update.configOptions);
      learnOffers(update.configOptions);
      touch();
      return;
    }
    if (update.sessionUpdate === 'available_commands_update') {
      commands = update.availableCommands.map(commandLeaf);
      emit('session', { type: 'session/customizationsChanged', customizations: [...seeds, ...commands] });
      return;
    }

    const current = mapping;
    // A cost reported before the prompt went out - on `session/new` or a
    // `session/load` replay, or between turns - is what the turn counts from,
    // and charged to none.
    if (update.sessionUpdate === 'usage_update' && current?.prompted !== true) {
      if (typeof update.cost?.amount === 'number') {
        cumulative = update.cost.amount;
        if (current !== undefined) current.costAtStart = cumulative;
      }
      return;
    }
    /*
     * While the session is opening, everything the server sends is the load's
     * replay.
     *
     * Whatever asked for the server - a turn, a resume, a reopen after a death
     * or a config the person set - those updates replay a conversation that was
     * already had, and belong to no turn this bridge began. Mapping them into
     * whichever turn happens to be running would put a whole conversation's
     * answer inside one turn's row.
     */
    if (loading) {
      replay.push(update);
      return;
    }
    if (current === undefined) return;
    // Kept before it is mapped, so a transcript rebuilt later sees the same
    // notifications the live client did, in the same order.
    watchedTurn?.updates.push({ update, at });
    /*
     * A usage is the turn's own total, held on the turn as well as sent, so a
     * client reading the snapshot mid-turn reads the same number the stream
     * last carried.
     */
    for (const action of mapUpdate(current, update, at)) {
      if (action.type === 'chat/usage' && active !== undefined) active.usage = bag(action.usage);
      emit('chat', action);
    }
  };

  /**
   * The `file://` URI a path names, which is what the host's store reads.
   *
   * Encoded rather than concatenated, because a path is allowed a space and a
   * store that reads a URI has to be given one it can parse.
   */
  const uriOf = (path: string): string => pathToFileURL(path).href;

  /** A file the agent asked to read, through the host's own store. */
  const readTextFile = async (request: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
    const store = start.resources;
    if (store === undefined) throw new Error(`${provider}: this session has no files to read`);
    const read = await store.read(uriOf(request.path));
    if (read.encoding !== 'utf-8') throw new Error(`${provider}: ${request.path} is not text`);
    // ACP sends `null` for absent as readily as it omits, so both mean the same.
    const line = request.line ?? undefined;
    const limit = request.limit ?? undefined;
    // A whole-file read is the common case and the one a server expects to be
    // exactly the file, so the split only happens when a range was asked for.
    if (line === undefined && limit === undefined) return { content: read.data };
    const lines = read.data.split('\n');
    const from = Math.max(0, (line ?? 1) - 1);
    return { content: lines.slice(from, limit === undefined ? undefined : from + limit).join('\n') };
  };

  /** One the agent asked to write. */
  const writeTextFile = async (request: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
    const store = start.resources;
    if (store?.write === undefined) throw new Error(`${provider}: this session has no files to write`);
    /*
     * Both sides of the write, so the turn's changeset holds what the file was
     * before this agent changed it beside what it is after. A write outside a
     * turn has no turn to attach them to, which is every write a server makes
     * while its session is opening.
     *
     * Both are waited for: the write truncates the file, so a `before` read
     * still in flight would find it already changed, and the turn ends after both.
     */
    const turnId = mapping?.turnId;
    if (turnId !== undefined) await start.onFileEdit?.(turnId, request.path, 'before');
    await store.write(uriOf(request.path), { data: request.content, encoding: 'utf-8', mode: 'truncate' });
    if (turnId !== undefined) await start.onFileEdit?.(turnId, request.path, 'after');
    return {};
  };

  /** The environment ACP sent, as the host's port takes it. */
  const environmentOf = (request: CreateTerminalRequest): Record<string, string> | undefined => {
    const list = request.env;
    if (list === undefined || list.length === 0) return undefined;
    const env: Record<string, string> = {};
    for (const one of list) env[one.name] = one.value;
    return env;
  };

  /** A shell the agent asked for, opened and listed by the host. */
  const openTerminal = async (request: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
    const shells = start.terminals;
    if (shells === undefined) throw new Error(`${provider}: this session has no shells`);
    const env = environmentOf(request);
    const handle = shells.open({
      cwd: request.cwd ?? where,
      command: request.command,
      ...(request.args !== undefined && request.args.length > 0 ? { args: request.args } : {}),
      ...(env === undefined ? {} : { env }),
    });
    terminals.set(handle.uri, {
      handle,
      ...(typeof request.outputByteLimit === 'number' ? { limit: request.outputByteLimit } : {}),
    });
    return { terminalId: handle.uri };
  };

  /** One by its own id, or a refusal the server reads as a failed request. */
  const terminalOf = (id: string): { handle: OpenedTerminal; limit?: number } => {
    const held = terminals.get(id);
    if (held === undefined) throw new Error(`${provider}: no terminal ${id}`);
    return held;
  };

  /** Everything it has printed, capped to what the request that opened it asked. */
  const terminalOutput = async (request: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
    const held = terminalOf(request.terminalId);
    const said = held.handle.output();
    const limit = held.limit;
    // The protocol truncates from the beginning to stay within the limit,
    // which keeps the tail: what a person watching wants is the end of it.
    const output = limit === undefined || said.output.length <= limit ? said.output : said.output.slice(-limit);
    return {
      output,
      truncated: output.length !== said.output.length,
      ...(said.exitCode === undefined ? {} : { exitStatus: { exitCode: said.exitCode } }),
    };
  };

  /** The wait the server does instead of polling. */
  const waitForTerminalExit = async (request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
    const done = await terminalOf(request.terminalId).handle.waitForExit();
    return {
      ...(done.exitCode === undefined ? {} : { exitCode: done.exitCode }),
      ...(done.signal === undefined ? {} : { signal: done.signal }),
    };
  };

  const killTerminal = async (request: KillTerminalRequest): Promise<KillTerminalResponse> => {
    terminalOf(request.terminalId).handle.kill();
    return {};
  };

  const releaseTerminal = async (request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
    terminalOf(request.terminalId).handle.release();
    terminals.delete(request.terminalId);
    return {};
  };

  /**
   * A permission the server is blocked on, put to a person.
   *
   * Every option the server lists is offered on the call, approvals before
   * refusals, and the one the person picks is the one the server is sent. An
   * answer that picked none selects the server's `allow_once` or
   * `reject_once` - never an `always`, which would change this session's
   * policy from a single answer - and a server with no once option of that
   * kind is answered `cancelled`, because selecting an `always` is a decision
   * the person did not make.
   */
  const askPermission = (request: RequestPermissionRequest): Promise<PermissionAnswer> => {
    const option = (kind: PermissionOptionKind): string | undefined =>
      request.options.find((one) => one.kind === kind)?.optionId;
    const allow = option('allow_once');
    const reject = option('reject_once');
    const offered = confirmationOptions(request.options);
    const toolCallId = request.toolCall.toolCallId;
    const requestId = `${toolCallId}:permission`;

    const answered = new Promise<PermissionAnswer>((resolve) => {
      permissions.set(toolCallId, {
        requestId,
        ...(allow === undefined ? {} : { allow }),
        ...(reject === undefined ? {} : { reject }),
        offered,
        settle: resolve,
      });
    });

    /*
     * The row, if the server asked without announcing the call first.
     *
     * Usually the `tool_call` update arrived before this and the part is the
     * one a client already draws, so it is found rather than replaced and only
     * its state moves.
     */
    const turnId = mapping?.turnId ?? '';
    const existing = mapping?.parts.find((one) => one.id === toolCallId);
    const call = existing === undefined ? {
      toolCallId,
      toolName: request.toolCall.name ?? request.toolCall.title ?? toolCallId,
      displayName: request.toolCall.title ?? request.toolCall.name ?? toolCallId,
      ...(request.toolCall.rawInput === undefined ? {} : { toolInput: JSON.stringify(request.toolCall.rawInput) }),
    } as Bag : bag(bag(existing).toolCall);
    // The arguments are on the question as well as on the row: a server sends
    // them with the request when the call is still `pending`, which is exactly
    // the call the mapping has written no arguments for.
    if (call.toolInput === undefined && request.toolCall.rawInput !== undefined) {
      call.toolInput = JSON.stringify(request.toolCall.rawInput);
    }
    call.status = 'pending-confirmation';
    call.invocationMessage = request.toolCall.title ?? call.toolName;
    call.confirmationTitle = request.toolCall.title ?? call.displayName;
    if (offered.length > 0) call.options = offered;
    delete call.confirmed;
    if (existing === undefined && mapping !== undefined) {
      mapping.parts.push({ id: toolCallId, kind: 'toolCall', toolCall: call });
      emit('chat', {
        type: 'chat/toolCallStart', turnId, toolCallId,
        toolName: call.toolName, displayName: call.displayName,
      });
    }
    /*
     * The call put back to `pending-confirmation`, with the choices on it.
     *
     * Sent even when the call was announced as running: a ready with no
     * `confirmed` is what moves a running call back to a question, and a
     * client that saw only the input-needed entry would draw the row as
     * running while the server waits.
     *
     * From here the mapping's own readiness for this call is this one, because
     * a status that moves while a person is being asked must not send a ready
     * behind this saying nobody is going to be. `asked` is what stops it, for
     * as long as the question stands.
     */
    const mapped = mapping?.calls.get(toolCallId);
    if (mapped !== undefined) {
      mapped.readied = true;
      mapped.asked = true;
    } else if (mapping !== undefined) {
      /*
       * The call the mapping will find on a later update, so one that arrives
       * now moves this call rather than opening a second row for it.
       */
      mapping.calls.set(toolCallId, {
        toolCallId,
        toolName: String(call.toolName),
        displayName: String(call.displayName),
        readied: true,
        asked: true,
      });
    }
    emit('chat', {
      type: 'chat/toolCallReady', turnId, toolCallId,
      invocationMessage: call.invocationMessage,
      ...(call.toolInput === undefined ? {} : { toolInput: call.toolInput }),
      confirmationTitle: call.confirmationTitle,
      ...(offered.length > 0 ? { options: offered } : {}),
    });
    emit('session', {
      type: 'session/inputNeededSet',
      request: { id: requestId, chat: start.chatUri, kind: 'toolConfirmation', turnId, toolCall: call },
    });
    doing('Waiting on you');
    touch();
    return answered;
  };

  /**
   * Every permission nobody will answer now, settled `cancelled`.
   *
   * The protocol asks a client that stops a turn to answer what its server is
   * still blocked on, so the server is not left waiting on a person who has
   * already said stop. Each entry takes its input-needed row with it: the
   * question was asked and has now been answered, and a client still drawing it
   * is offering a decision nobody can make.
   *
   * The settle is what a close does here, which is why both go through this.
   */
  const settlePermissions = (): void => {
    for (const held of permissions.values()) {
      emit('session', { type: 'session/inputNeededRemoved', id: held.requestId });
      held.settle('cancelled');
    }
    permissions.clear();
  };

  /**
   * The machine this session was told to run in, as something to spawn.
   *
   * A session whose settings name a computer runs the server there, through
   * the port the host carries - decision
   * `a-backend-reaches-a-computer-through-a-port`. A name that cannot be
   * reached throws rather than falling back to this host: a session that asked
   * for a sandbox and silently ran outside one is worse than one that did not
   * start.
   */
  const placed = async (): Promise<Spawn | undefined> => {
    // Trimmed and emptiness-checked in one place, because the computer plugin's
    // schema says an empty value runs on the host and that arrives as often as
    // an absent one does.
    const said = machineAsked(start);
    if (said === undefined) return undefined;
    const named = /^computer:\/\/([^/\s]+)$/.exec(said);
    if (named === null) throw new Error(`${said} is not a computer URI; a session runs in computer://<id>`);
    const id = named[1] as string;
    if (start.computers === undefined) {
      throw new Error(`This session asked to run in ${id}, and this host has no computer plugin to run it in`);
    }
    /*
     * No `cwd` here: `where` is this host's directory, and the only paths that
     * mean anything inside the machine are its own. The port uses the
     * machine's working directory when the caller names none.
     */
    const spawn = await start.computers.how(id, {
      command: options.command,
      ...(options.args === undefined ? {} : { args: options.args }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    if (spawn === undefined) throw new Error(`There is no computer called ${id}`);
    return spawn;
  };

  /**
   * The sign-in the spec named, sent once between the handshake and the
   * session.
   *
   * Nothing is sent when the spec names no method, and a method the server did
   * not offer fails the start naming the ones it did: a bridge that guessed
   * would sign a person in as whoever the guess was, and the guess is not
   * something a configuration can be corrected about afterwards.
   *
   * A sign-in the server refuses is the server's own refusal, said as it made
   * it, rather than a request for a sign-in nobody has made.
   */
  const signIn = async (connection: AcpConnection): Promise<void> => {
    const asked = options.authenticate;
    if (asked === undefined) return;
    if (!signIns.includes(asked.methodId)) {
      const offered = signIns.join(', ');
      throw new Error(`${provider} offers ${offered === '' ? 'no sign-in method' : offered}, not ${asked.methodId}`);
    }
    await connection.authenticate({
      methodId: asked.methodId,
      ...(asked._meta === undefined ? {} : { _meta: asked._meta }),
    }).catch((why: unknown) => {
      // A server that answers the sign-in and refuses it has said why, and that
      // is the turn's failure. The protocol's `auth_required` would send the
      // person back to the option they have already set.
      throw new Error(`${provider}: sign-in with ${asked.methodId} failed: ${messageOf(why)}`);
    });
  };

  /**
   * The protocol's `auth_required`, as the error a turn ends with.
   *
   * A server answers `session/new` and `session/prompt` with it when it wants
   * to be signed in, and the generic failure would carry the sentence
   * "Authentication required" with nothing to do about it. The methods come
   * from the handshake, which is the only place they are ever named.
   */
  const signInFailure = (why: unknown): { errorType: string; message: string } | undefined => {
    if (!(why instanceof RequestError) || why.code !== AUTH_REQUIRED) return undefined;
    const offered = signIns.length === 0 ? 'offers no sign-in method' : `offers ${signIns.join(', ')}`;
    return {
      errorType: 'authRequired',
      message: `${provider}: this ACP server wants to be signed in before it answers, and ${offered}; set the authenticate option to the one to use`,
    };
  };

  /**
   * Spawn the server, hand it a client, and open the one session on it.
   *
   * One promise for the whole of it, so a second turn that arrives while the
   * first is still shaking hands waits on the same server rather than spawning
   * another. A failure clears it, so the next turn tries again.
   *
   * A resume is a `session/load` rather than a `session/new`, and so is the
   * reopen after a death, because both are the same conversation: only a server
   * that advertised `loadSession` can be asked either way. Silently starting a
   * new conversation instead would be a session that had lost everything it was
   * resumed or continued for, with nothing on screen saying so.
   */
  const open = (): Promise<{ connection: AcpConnection; sessionId: string }> => {
    if (opening !== undefined) return opening;
    loading = true;
    const pending = (async () => {
      const moved = await placed();
      const connection = connectAcp({
        command: moved?.command ?? options.command,
        ...(moved !== undefined
          ? { args: moved.args }
          : options.args === undefined ? {} : { args: options.args }),
        ...(moved?.env !== undefined
          ? { env: moved.env }
          : moved === undefined && options.env !== undefined ? { env: options.env } : {}),
        ...(moved?.cwd !== undefined ? { cwd: moved.cwd } : moved === undefined ? { cwd: where } : {}),
        handlers: {
          update: receivedUpdate,
          permission: askPermission,
          // Each half only where the session has what it needs: an
          // unadvertised capability is a request a conformant server never
          // makes, and one with nothing behind it would throw.
          ...(start.resources === undefined
            ? {}
            : {
                readTextFile,
                ...(start.resources.write === undefined ? {} : { writeTextFile }),
              }),
          ...(start.terminals === undefined
            ? {}
            : { createTerminal: openTerminal, terminalOutput, waitForTerminalExit, killTerminal, releaseTerminal }),
        },
      });
      live = connection;
      // A server that dies between turns is let go, so the next turn spawns
      // another rather than prompting a process that is no longer there.
      void connection.ended.then(() => {
        if (live !== connection) return;
        live = undefined;
        opening = undefined;
      });
      const handshake = await connection.initialize();
      closes = advertised(handshake.agentCapabilities?.sessionCapabilities?.close);
      takes = handshake.agentCapabilities?.promptCapabilities ?? undefined;
      extras = advertised(handshake.agentCapabilities?.sessionCapabilities?.additionalDirectories);
      signIns = (handshake.authMethods ?? []).map((one) => one.id);
      await signIn(connection);
      /*
       * The directories beside the one the server runs in, only to a server that
       * advertised them.
       *
       * ACP calls this an optional capability, and a server that never said it
       * takes them cannot be handed a field it does not know: the directories
       * are remembered on this session either way, so nothing is lost by not
       * sending them.
       */
      const extra = extras && start.additional !== undefined && start.additional.length > 0
        ? { additionalDirectories: start.additional }
        : {};
      /*
       * The servers this session is opened with: the host's own, less what the
       * handshake says this server cannot take, plus the host's tools as one
       * HTTP server unless the deployment turned that off.
       */
      const servers = serversFor(start, toolsServer, handshake.agentCapabilities, options.hostTools !== false, (line) => options.log?.(line));
      /*
       * The conversation to continue: the one a resume named, or the one this
       * session already had when its server died. Both go through the same
       * call, because they are the same thing - a conversation this bridge has
       * to hand back to a server rather than start again.
       */
      const reopen = start.resume ?? acpSessionId;
      if (reopen !== undefined) {
        if (handshake.agentCapabilities?.loadSession !== true) {
          throw new Error(start.resume === undefined
            ? `${provider}: the server died and this one cannot load a session, so "${reopen}" cannot be continued`
            : `${provider}: this ACP server cannot load a session, so "${reopen}" cannot be resumed`);
        }
        const loaded = await connection.loadSession({
          sessionId: reopen,
          cwd: where,
          mcpServers: servers,
          ...extra,
        });
        acpSessionId = reopen;
        learnModes(loaded.modes);
        learnOffers(loaded.configOptions);
        learnModels(loaded);
      }
      else {
        const created = await connection.newSession({
          cwd: where,
          mcpServers: servers,
          ...extra,
        });
        acpSessionId = created.sessionId;
        learnModes(created.modes);
        learnOffers(created.configOptions);
        learnModels(created);
      }
      /*
       * The catalogue's record starts here, where the server has named the
       * session and what it said is known. The turn already running is attached
       * because `begin` opens it before the server does, and a transcript that
       * dropped the first turn would be a conversation missing its question.
       */
      record = watchSession({
        provider,
        id: acpSessionId,
        cwd: where,
        additional: start.additional ?? [],
        title,
        replay,
      });
      /*
       * The record has it now, and this list must not keep it: a server that
       * dies and is reopened replays the whole conversation again, and a list
       * that still held the first replay would push it a second time.
       */
      replay.length = 0;
      if (watchedTurn !== undefined && !record.turns.includes(watchedTurn)) record.turns.push(watchedTurn);
      return { connection, sessionId: acpSessionId };
    })();
    opening = pending;
    // The replay ends where the open does, whether it worked or not: what the
    // server said on the way belongs to no turn after this point.
    const opened = (): void => { loading = false; };
    void pending.then(opened, opened);
    return pending;
  };

  /** Open a turn on the wire, before the prompt is sent. */
  const openTurn = (
    turnId: string,
    text: string,
    from: MessageFrom | undefined,
    queuedMessageId: string | undefined,
  ): void => {
    active = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      },
      responseParts: [],
    };
    watchedTurn = {
      turnId,
      startedAt: String(active.startedAt),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
      },
      state: 'complete',
      updates: [],
    };
    emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: active.startedAt,
      message: active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    doing('Thinking');
  };

  /**
   * End the running turn, whoever ended it.
   *
   * How it ended is the server's to say: `stopReasonFor` reads the stop reason
   * into one of the three endings. A connection that failed before a stop reason
   * arrived is an error, with the reason on the turn and the type this bridge
   * uses for a failure of its own.
   */
  const finish = (
    turnId: string,
    ending: 'complete' | 'cancelled' | 'error',
    failure: { errorType: string; message: string } = {
      errorType: 'turnFailed',
      message: 'The ACP server did not answer',
    },
  ): void => {
    const turn = active;
    if (turn === undefined || String(turn.id) !== turnId) return;
    doing(undefined);
    const duration = Date.now() - Date.parse(String(turn.startedAt));
    turn.state = ending;
    turn.duration = duration;
    turns.push(turn);
    // The watched turn is sealed here, which is what makes a transcript a
    // record of turns rather than of one long stream of updates.
    if (watchedTurn !== undefined && watchedTurn.turnId === turnId) {
      watchedTurn.state = ending;
      watchedTurn.duration = Number.isFinite(duration) ? duration : 0;
      /*
       * What the turn last said it had spent, which the updates alone cannot
       * say: the token counts arrive with the prompt's answer, and a cost is
       * reported for the whole session, so what this turn spent is its share
       * of a total it opened at a number the replay never knew.
       */
      if (turn.usage !== undefined) watchedTurn.usage = bag(turn.usage);
      // Every turn after the first is sealed here rather than at the open that
      // precedes it, because the open already happened for it.
      if (record !== undefined && !record.turns.includes(watchedTurn)) record.turns.push(watchedTurn);
      watchedTurn = undefined;
    }
    // Nothing in the protocol says when the agent has finished writing a plan,
    // so the turn ending is what closes the call it is held in.
    if (mapping !== undefined) for (const action of closePlan(mapping)) emit('chat', action);
    // Before the ending action, not after: the host reads `status()` as it
    // passes that action on, and a turn still active there reads as running.
    active = undefined;
    if (mapping?.cost !== undefined) cumulative = mapping.cost.amount;
    mapping = undefined;
    cancelRequested = false;
    if (ending === 'complete') emit('chat', { type: 'chat/turnComplete', turnId, duration });
    else if (ending === 'cancelled') emit('chat', { type: 'chat/turnCancelled', turnId, duration });
    else {
      const message = failure.message === '' ? 'The ACP server did not answer' : failure.message;
      failed = message;
      emit('chat', {
        type: 'chat/error',
        turnId,
        duration,
        part: { kind: 'error', error: { errorType: failure.errorType, message } },
      });
    }
    touch();
    // Somebody stopping a turn is stopping this conversation; a queued message
    // behind it is the opposite of what they asked for.
    if (ending !== 'cancelled') startNext();
  };

  /**
   * End the turn the way the server's stop reason says to.
   *
   * The reason is the error's type as well as its sentence, so a client can tell
   * a refusal from a ceiling reached without reading prose, and the sentence
   * says the agent declined rather than that something broke - a refusal is
   * something the agent did.
   */
  const stopReasonFor = (turnId: string, reason: StopReason): void => {
    if (reason === 'cancelled') return finish(turnId, 'cancelled');
    const said = NOT_AN_ANSWER[reason];
    if (said === undefined) return finish(turnId, 'complete');
    finish(turnId, 'error', { errorType: reason, message: said });
  };

  /**
   * Point the server at the model the turn asked for, before the prompt.
   *
   * ACP carries the model as a session config option, so the choice is one
   * `session/set_config_option` when the server's current value differs. A
   * failure here fails the turn rather than prompting with the wrong model: an
   * answer from a model nobody selected is worse than an error saying so.
   */
  const chooseModel = async (
    held: { connection: AcpConnection; sessionId: string },
    chosen: Chosen | undefined,
  ): Promise<void> => {
    if (chosen === undefined) return;
    const option = modelOption();
    /*
     * A server from before config options has no option to set, and takes the
     * model by the call it knew instead. The list it named is the only place
     * a choice can be checked against, so an id it did not offer is the same
     * failure as a server that offered none.
     */
    if (option === undefined) {
      const listed = listedModels ?? [];
      const served = listed.find((one) => one.id === chosen.id);
      if (served === undefined) {
        throw new Error(`${provider}: this ACP server names no model option, so "${chosen.id}" cannot be chosen`);
      }
      if (settings.model === served.id) return;
      await held.connection.setModel({ sessionId: held.sessionId, modelId: served.id });
      settings.model = served.id;
      return;
    }
    if (option.currentValue === chosen.id) return;
    const answer = await held.connection.setSessionConfigOption({
      sessionId: held.sessionId,
      configId: option.id,
      value: chosen.id,
    });
    learnOffers(answer.configOptions);
  };

  /**
   * What the prompt response said the turn used, as its last report.
   *
   * ACP counts no tokens per call, so the response is the only place a turn's
   * counts appear, and they arrive with the turn already over - which is why
   * this goes out before the ending action, the way the reports during the
   * turn did: the host reads `status()` as that action passes, and a usage is
   * hung on the turn that is still running.
   *
   * The cost the updates carried is kept rather than replaced, because tokens
   * are one measurement and the price of them another and this response names
   * no price at all. A response with no usage therefore says the cost on its
   * own, and one that reported neither says nothing, because what the updates
   * already sent stands.
   */
  const saidUsage = (usage: Usage | null | undefined): void => {
    const turn = active;
    const held = mapping;
    if (turn === undefined || held === undefined) return;
    const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const wrote = num(usage?.cachedWriteTokens);
    const thought = num(usage?.thoughtTokens);
    const price = held.cost === undefined
      ? undefined
      : { amount: held.cost.amount - (held.costAtStart ?? 0), currency: held.cost.currency };
    const filled = bag(bag(held.usage)._meta).context;
    const said: Bag = {
      ...(num(usage?.inputTokens) !== undefined ? { inputTokens: num(usage?.inputTokens) } : {}),
      ...(num(usage?.outputTokens) !== undefined ? { outputTokens: num(usage?.outputTokens) } : {}),
      ...(num(usage?.cachedReadTokens) !== undefined ? { cacheReadTokens: num(usage?.cachedReadTokens) } : {}),
      /*
       * Cache writes, thinking and the context window ride `_meta`, which is
       * where the protocol carries a measurement it names no field for, and
       * where the other backends already put them. The context is the one the
       * updates already reported and this response knows nothing about, so it
       * is kept rather than dropped at the turn's last word.
       */
      ...(wrote !== undefined || thought !== undefined || price !== undefined || filled !== undefined
        ? {
            _meta: {
              ...(wrote !== undefined ? { cacheWriteTokens: wrote } : {}),
              ...(thought !== undefined ? { reasoningTokens: thought } : {}),
              ...(price !== undefined ? { cost: price } : {}),
              ...(filled === undefined ? {} : { context: filled }),
            },
          }
        : {}),
    };
    if (Object.keys(said).length === 0) return;
    turn.usage = said;
    emit('chat', { type: 'chat/usage', turnId: String(turn.id), usage: said });
  };

  /**
   * The URI an attachment with no URI of its own is sent under.
   *
   * A pasted image is bytes with a name and nothing to point at, and ACP's
   * blocks name what they carry. The scheme is this bridge's own, as the one a
   * command leaf uses: nothing reads it, so it has to be honest rather than
   * resolve.
   */
  const attachmentUri = (label: string): string => `acp-attachment:${provider}/${label}`;

  /** An attachment the server cannot take, named where the text can carry it. */
  const named = (label: string): ContentBlock => ({ type: 'text', text: `[${label}]` });

  /**
   * The content a `resource` attachment points at, read as the store holds it.
   *
   * ACP's embedded resource carries the bytes rather than pointing at them, so
   * a file the client named by URI is read here - the same read
   * `fs/read_text_file` makes, and for the same reason: the agent gets what the
   * person attached rather than a path it cannot open.
   */
  const contentOf = async (
    uri: string,
    mime: string | undefined,
  ): Promise<TextResourceContents | BlobResourceContents | undefined> => {
    const store = start.resources;
    if (store === undefined) return undefined;
    try {
      const read = await store.read(uri);
      const said = mime ?? read.contentType;
      return read.encoding === 'base64'
        ? { uri, blob: read.data, ...(said === undefined ? {} : { mimeType: said }) }
        : { uri, text: read.data, ...(said === undefined ? {} : { mimeType: said }) };
    }
    catch {
      // A file the store will not read is an attachment this turn cannot carry.
      return undefined;
    }
  };

  /**
   * The blocks one turn is prompted with: what was said, then whatever of the
   * message's attachments the server said it can take.
   *
   * ACP asks a server to opt into everything past text, so an image is an image
   * block only where `promptCapabilities.image` says so, and a file is an
   * embedded resource only where `embeddedContext` does. Whatever the server
   * did not ask for is named in the text rather than dropped, because a message
   * carrying a picture the agent never heard about is a message that is missing
   * something.
   */
  const blocksFor = async (text: string, attachments: MessageAttachment[] | undefined): Promise<ContentBlock[]> => {
    const blocks: ContentBlock[] = [{ type: 'text', text }];
    for (const one of attachments ?? []) {
      // What the producer wrote for the model is text, which every server takes.
      const written = (one as { modelRepresentation?: unknown }).modelRepresentation;
      if ((one as { type: string }).type === 'simple' && typeof written === 'string' && written !== '') {
        blocks.push({ type: 'text', text: written });
        continue;
      }
      const picture = inline(one) && one.contentType.startsWith('image/');
      if (picture && takes?.image === true) {
        blocks.push({
          type: 'image',
          data: one.data,
          mimeType: one.contentType,
          uri: attachmentUri(one.label),
        });
        continue;
      }
      /*
       * An image the server will not take is named rather than sent as a
       * resource, because `embeddedContext` is about context a message refers
       * to and an image is not that; the sentence that named it is what the
       * agent is left with.
       */
      if (!picture && takes?.embeddedContext === true) {
        const resource = inline(one)
          ? { uri: attachmentUri(one.label), blob: one.data, mimeType: one.contentType }
          : referencing(one) ? await contentOf(one.uri, one.contentType) : undefined;
        if (resource !== undefined) {
          blocks.push({ type: 'resource', resource });
          continue;
        }
      }
      blocks.push(named(one.label));
    }
    return blocks;
  };

  /**
   * One turn: the prompt is sent, and what comes back ends it.
   *
   * A cancel that arrived while the server was still being opened ends the
   * turn without a prompt at all, because there is nothing running to stop.
   */
  const run = async (
    turnId: string,
    text: string,
    chosen: Chosen | undefined,
    attachments: MessageAttachment[] | undefined,
  ): Promise<void> => {
    /** The connection this turn opened, which outlives `live` once it dies. */
    let connection: AcpConnection | undefined;
    try {
      const held = await open();
      connection = held.connection;
      const turn = active;
      if (closed || turn === undefined || String(turn.id) !== turnId) return;
      if (cancelRequested) {
        finish(turnId, 'cancelled');
        return;
      }
      /*
       * The turn's mapping, opened only now that the server has answered.
       *
       * Set after the open rather than before it, because everything the
       * server sends while it is opening is the load's replay and belongs to no
       * turn this bridge began. The cost baseline is read here too, so a turn
       * counts from what the session had spent once the replay was counted in
       * and not from what it had spent before.
       */
      mapping = {
        turnId,
        parts: turn.responseParts as Bag[],
        calls: new Map(),
        reach: {
          within: inside,
          changed: (path, before) => {
            if (before !== undefined) start.onFileEdit?.(turnId, path, 'before', before);
            start.onFileEdit?.(turnId, path, 'after');
          },
        },
        ...(cumulative !== undefined ? { costAtStart: cumulative } : {}),
      };
      await chooseModel(held, chosen);
      mapping.prompted = true;
      const response = await held.connection.prompt(held.sessionId, await blocksFor(text, attachments));
      saidUsage(response.usage);
      stopReasonFor(turnId, response.stopReason);
    }
    catch (why: unknown) {
      // The opening is cleared so the next turn spawns a server again rather
      // than awaiting a promise that will never resolve, and the connection is
      // closed so the failed attempt does not leave a subprocess behind.
      opening = undefined;
      live = undefined;
      connection?.close();
      /*
       * A server that wants to be signed in says so with its own error, and
       * the turn ends as that rather than as a failure nobody can act on: the
       * sentence names the methods the handshake offered, because a client is
       * not sent back to the server for them and `authenticate` takes an id
       * out of that list.
       */
      const signIn = signInFailure(why);
      if (signIn !== undefined) {
        finish(turnId, 'error', signIn);
        return;
      }
      /*
       * Whatever the server said on stderr rides on the failure, because an
       * exit code is rarely why and the trace under it is. Read from the
       * connection this turn prompted: a server that died is already off
       * `live`, which is exactly the case a person most wants the trace for.
       */
      const said = messageOf(why);
      const tail = connection === undefined ? '' : await connection.stderrTail();
      finish(turnId, 'error', {
        errorType: 'turnFailed',
        message: tail === '' ? said : `${said}\n${tail}`,
      });
    }
  };

  /**
   * One shell command, run by the host rather than asked of the server.
   *
   * `!ls` is a person's command, not a prompt: the host spawns the shell and
   * hands back what it printed, so nothing here reaches the ACP server. The
   * turn is still this chat's and still a turn - it opens, carries one tool
   * call and completes - which is what puts the command and its output in the
   * transcript beside the conversation it interrupted.
   *
   * The ACP connection is not touched: a server that is mid-prompt is not
   * asked to stop, and one that is idle stays idle. Any `session/update` that
   * arrives meanwhile is dropped, because `mapping` is deliberately cleared
   * while a command runs - there is no model turn for it to belong to.
   */
  const runCommand = (
    turnId: string,
    command: string,
    run: (toolCallId: string) => Promise<Ran>,
    queuedMessageId?: string,
  ): void => {
    if (closed || active !== undefined) return;
    cancelRequested = false;
    failed = undefined;
    if (title === UNTITLED && command !== '') {
      title = command.slice(0, 60);
      if (record !== undefined) record.title = title;
      emit('session', { type: 'session/titleChanged', title });
    }
    const began = Date.now();
    const toolCallId = `${turnId}:command`;
    /*
     * `terminal` as the name, which is what a client draws a shell by.
     *
     * The call is held as the turn's one part, so a client that subscribes
     * after the command finished reads the row from the snapshot rather than
     * the actions it missed.
     */
    const call: Bag = {
      toolCallId,
      toolName: 'terminal',
      displayName: 'Terminal',
      intention: command,
      invocationMessage: command,
      toolInput: command,
      confirmed: 'not-needed',
      status: 'running',
      _meta: callTimes(began),
    };
    const part: Bag = { id: toolCallId, kind: 'toolCall', toolCall: call };
    active = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: { text: `!${command}`, origin: { kind: 'user' } },
      responseParts: [part],
    };
    // No ACP turn is running, so a stray `session/update` has nothing to be
    // mapped into and is dropped rather than written into this shell's turn.
    mapping = undefined;
    emit('chat', {
      type: 'chat/turnStarted', turnId, startedAt: active.startedAt, message: active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    emit('chat', {
      type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'terminal', displayName: 'Terminal', intention: command,
    });
    emit('chat', {
      type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: command, confirmed: 'not-needed', toolInput: command,
      _meta: callTimes(began),
    });
    doing('Running');
    touch();
    void run(toolCallId).then((done) => {
      if (active === undefined || String(active.id) !== turnId) return;
      /*
       * The terminal first, so a client can watch the output arrive, then the
       * text it printed. `content` replaces rather than appends, so the two go
       * out together in the one action that closes the row.
       */
      const content: Bag[] = [
        ...(done.terminal === undefined ? [] : [{
          type: 'terminal',
          resource: done.terminal,
          title: 'Terminal',
          // Pipes, not a pseudoterminal: a client reads this to decide whether
          // the preview needs VT parsing.
          isPty: false,
          result: {
            ...(done.code !== undefined ? { exitCode: done.code } : {}),
            ...(done.output === '' ? {} : { preview: done.output }),
          },
        }]),
        ...(done.output === '' ? [] : [{ type: 'text', text: done.output }]),
      ];
      const result: Bag = {
        success: done.success,
        pastTenseMessage: done.said,
        content,
        ...(done.success ? {} : { error: { message: done.said } }),
      };
      // Into the part as well, so the snapshot a late subscriber reads holds
      // the finished call rather than the `running` one it was opened with.
      Object.assign(call, result, {
        status: 'completed',
        confirmed: 'not-needed',
        _meta: withCallTimes(bag(call._meta), callTimes(began, Date.now())),
      });
      emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId, result, _meta: bag(call._meta) });
      const turn = active;
      const duration = Date.now() - began;
      turn.state = done.success ? 'complete' : 'error';
      turn.duration = duration;
      turns.push(turn);
      active = undefined;
      if (!done.success) failed = done.said;
      /*
       * The turn closes like any other.
       *
       * A shell command is a turn of this chat, so a client that watched it
       * needs the same completion a model's answer gets; without it the row
       * stays open on screen while the session already counts it as done.
       */
      emit('chat', { type: 'chat/turnComplete', turnId, duration });
      doing(undefined);
      touch();
      startNext();
    });
  };

  /** Begin a turn, once the session is free. */
  const begin = (
    turnId: string,
    text: string,
    model: Chosen | undefined,
    from: MessageFrom | undefined,
    attachments: MessageAttachment[] | undefined,
    queuedMessageId?: string,
  ): void => {
    if (closed || active !== undefined) return;
    cancelRequested = false;
    failed = undefined;
    if (title === UNTITLED && text !== '') {
      title = text.slice(0, 60);
      if (record !== undefined) record.title = title;
      // Said, because a client that opened the session holds the old one.
      emit('session', { type: 'session/titleChanged', title });
    }
    openTurn(turnId, text, from, queuedMessageId);
    void run(turnId, text, model, attachments);
  };

  /**
   * The head of the queue, once there is nothing running.
   *
   * A queued `!command` is *run* rather than sent: `ran` queued the command
   * itself when a turn was already running, and handing its text to the server
   * as a prompt is the one thing the `!` prefix exists not to do.
   */
  const startNext = (): void => {
    if (active !== undefined || closed) return;
    const next = queued.shift();
    if (next === undefined) return;
    const held = bag(next.command);
    const typed = typeof held.text === 'string' ? held.text : undefined;
    if (typed !== undefined && typeof held.run === 'function') {
      runCommand(crypto.randomUUID(), typed, held.run as (toolCallId: string) => Promise<Ran>, String(next.id));
      return;
    }
    const message = bag(next.message);
    begin(
      crypto.randomUUID(),
      String(message.text ?? ''),
      next.model as Chosen | undefined,
      next.from as MessageFrom | undefined,
      // A queued message carries no attachments: `Session.queue` takes none.
      undefined,
      String(next.id),
    );
  };

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    /**
     * The models this session can run a turn on.
     *
     * Read from the server's own model option, or from the list a server from
     * before options named instead, because only the server knows what it
     * serves. Before the session has opened there is no honest answer but an
     * empty list: the agent's `probe` cannot know either, ACP advertising
     * models on `session/new` rather than on `initialize`.
     */
    models: () => {
      const option = modelOption();
      if (option !== undefined) return choicesOf(option).map((choice) => ({ id: choice.value, name: choice.name }));
      return listedModels ?? [];
    },
    agentId: () => acpSessionId,
    customizations: () => [...seeds, ...commands],
    allTurns: () => turns,
    status,
    activity: () => activity,
    title: () => title,
    /*
     * A person's rename, which the host announces and this only keeps. The
     * flag is the whole of what a title needs here: the protocol has no rename
     * of its own, so there is nothing to say to the server.
     */
    setTitle: (said) => {
      if (said === '') return;
      title = said;
      renamed = true;
      if (record !== undefined) record.title = said;
      touch();
    },
    modifiedAt: () => modified,
    workingDirectories: () => [`file://${where}`],

    sessionState: () => ({
      resource: start.uri,
      provider,
      title,
      status: status(),
      lifecycle: 'ready',
      defaultChat: start.chatUri,
      chats: [{ resource: start.chatUri, title }],
      workingDirectories: [`file://${where}`],
      customizations: [...seeds, ...commands],
      ...(activity !== undefined ? { activity } : {}),
      // The schema *and* what is in force: a client reads
      // `config.schema.properties` for the controls and `config.values` for
      // where each one sits. The schema carries the server's modes once they
      // are known, so `permissionMode` has an enum exactly when it can have one.
      config: { schema: schemaOf(), values: { ...settings } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title,
      status: status(),
      modifiedAt: modified,
      turns,
      ...(active !== undefined ? { activeTurn: active } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(draft !== undefined ? { draft } : {}),
      queuedMessages: queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    begin: (turnId, text, model, from, attachments) => begin(turnId, text, model, from, attachments),

    /**
     * A person's `!command`, run by the host in one of its own shells.
     *
     * An ACP server has no shell turn of its own, so this turn belongs to the
     * bridge: the host spawns the shell and this session opens the turn around
     * it. The command waits its turn when one is already running, because a
     * shell that jumped the queue would run against a tree the turn in front
     * of it is still editing - and what waits is the command, not its text, so
     * `startNext` runs it rather than asking the server about `!ping`.
     */
    ran: (turnId, command, run, queuedAs) => {
      if (active !== undefined || (queuedAs !== undefined && queued.length > 0)) {
        const id = queuedAs ?? turnId;
        const message: Bag = { text: `!${command}`, origin: { kind: 'user' } };
        const entry: Bag = { id, command: { text: command, run }, message };
        const at = queued.findIndex((held) => held.id === id);
        if (at >= 0) queued[at] = entry;
        else queued.push(entry);
        emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
        touch();
        return;
      }
      runCommand(turnId, command, run, queuedAs);
    },

    /**
     * Stop the running turn.
     *
     * The ACP cancel notification is what a server stops on, and the `cancelled`
     * stop reason it answers the prompt with is what emits `chat/turnCancelled`
     * exactly once. This must not send one of its own, or a client sees two.
     *
     * The permissions are answered before it goes, because a server told to stop
     * while it is blocked on a question of this client's is a server that never
     * gets past the question.
     */
    cancel: (turnId) => {
      const turn = active;
      if (turn === undefined || String(turn.id) !== turnId) return;
      cancelRequested = true;
      settlePermissions();
      doing('Cancelling');
      const connection = live;
      if (connection !== undefined && acpSessionId !== undefined) {
        // Fire and forget: the prompt's own resolution is what ends the turn.
        void connection.cancel(acpSessionId).catch(() => {});
      }
    },

    queue: (id, text, model, from) => {
      const entry: Bag = {
        id,
        message: { text },
        ...(model !== undefined ? { model } : {}),
        ...(from !== undefined ? { from } : {}),
      };
      const at = queued.findIndex((held) => held.id === id);
      if (at >= 0) queued[at] = entry;
      else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
      touch();
      startNext();
    },

    unqueue: (id) => {
      const at = queued.findIndex((held) => held.id === id);
      if (at < 0) return;
      queued.splice(at, 1);
      emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      touch();
    },

    reorder: (order) => {
      const byId = new Map(queued.map((held) => [String(held.id), held]));
      const seen = new Set<string>();
      const moved: Bag[] = [];
      for (const id of order) {
        const held = byId.get(id);
        if (held === undefined || seen.has(id)) continue;
        seen.add(id);
        moved.push(held);
      }
      // Anything the order did not name keeps its place behind what it did.
      for (const held of queued) if (!seen.has(String(held.id))) moved.push(held);
      queued.length = 0;
      queued.push(...moved);
      emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => String(held.id)) });
      touch();
    },

    // Held by the session, so two people on one chat see each other's.
    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    /**
     * A person's answer to the permission the server is waiting on.
     *
     * Found by the tool call the entry names rather than assumed to be the one
     * held, because two calls can be waiting at once and answering the wrong
     * one is worse than answering none. The option picked is sent when the
     * server offered it and it is of the answer's kind; otherwise the once
     * option of that kind, and with none the request is refused instead, with
     * the person's answer standing as the reason.
     */
    confirm: (toolCallId, approved, optionId) => {
      const held = permissions.get(toolCallId);
      if (held === undefined) return;
      permissions.delete(toolCallId);
      emit('session', { type: 'session/inputNeededRemoved', id: held.requestId });
      const picked = held.offered.find((one) => one.id === optionId && one.kind === (approved ? 'approve' : 'deny'));
      const part = mapping?.parts.find((one) => one.id === toolCallId);
      if (part !== undefined) {
        const call = bag(bag(part).toolCall);
        call.status = approved ? 'running' : 'cancelled';
        if (approved) call.confirmed = 'user-action';
        delete call.options;
        delete call.confirmationTitle;
        if (picked !== undefined) call.selectedOption = picked;
      }
      emit('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: mapping?.turnId,
        toolCallId,
        approved,
        ...(approved ? { confirmed: 'user-action' } : {}),
        ...(picked === undefined ? {} : { selectedOptionId: picked.id }),
      });
      const chosen = picked?.id ?? (approved ? held.allow : held.reject);
      held.settle(chosen === undefined ? 'cancelled' : { optionId: chosen });
      doing(approved ? 'Running' : 'Thinking');
      touch();
    },

    /*
     * ACP asks no questions of its own here.
     *
     * Its only interactive request is `session/request_permission`, which is
     * the confirmation above; there is no question shape to answer, so an
     * answer names something this session never asked.
     */
    answer: () => {},

    /**
     * Take a config value, in the server's own terms.
     *
     * Two keys are this backend's: `permissionMode` is the server's mode, and
     * `model` is its model option. `model` is set here even though it is not a
     * schema property, because a model belongs to the turn rather than to the
     * conversation and a client may still send one. Every other option the
     * server offered is a control of its own under `acp.<id>`, and a key
     * naming no option at all is refused by name, because only this backend
     * knows what the server serves.
     */
    setConfig: async (key, value): Promise<true | string> => {
      /*
       * The value asked for, held before the request goes out, so the server's
       * own update echoing it back is not announced as a change; put back if the
       * request fails.
       */
      let sent: { key: string; before: unknown } | undefined;
      const unsent = (): void => {
        if (sent !== undefined) settings[sent.key] = sent.before;
      };
      if (key === 'permissionMode') {
        if (typeof value !== 'string') return `${provider}: permissionMode takes a string`;
        try {
          const held = await open();
          // The `mode` option is the server's own account of this, so it is
          // asked through the same call as any other option; the legacy modes
          // are what is left when it names none.
          const option = modeOption();
          sent = { key, before: settings[key] };
          settings[key] = value;
          if (option === undefined) {
            await held.connection.setSessionMode({ sessionId: held.sessionId, modeId: value });
            if (modes !== undefined) modes = { ...modes, currentModeId: value };
          }
          else {
            learnOffers((await held.connection.setSessionConfigOption({
              sessionId: held.sessionId,
              configId: option.id,
              value,
            })).configOptions);
          }
          touch();
          return true;
        }
        catch (why: unknown) {
          unsent();
          return `${provider}: permissionMode was not set: ${messageOf(why)}`;
        }
      }
      if (key === 'model') {
        if (typeof value !== 'string') return `${provider}: model takes a string`;
        try {
          // Opened before the option is looked for: the server names its model
          // option on `session/new`, so a session that has not opened has not
          // been told what a model may be set to.
          const held = await open();
          const option = modelOption();
          if (option === undefined) {
            // A server from before config options takes it by the older call,
            // as a turn naming one does.
            if (!(listedModels ?? []).some((one) => one.id === value)) {
              return `${provider}: this ACP server names no model option, so model cannot be set`;
            }
            sent = { key, before: settings[key] };
            settings[key] = value;
            await held.connection.setModel({ sessionId: held.sessionId, modelId: value });
            touch();
            return true;
          }
          sent = { key, before: settings[key] };
          settings[key] = value;
          const answer = await held.connection.setSessionConfigOption({
            sessionId: held.sessionId,
            configId: option.id,
            value,
          });
          learnOffers(answer.configOptions);
          touch();
          return true;
        }
        catch (why: unknown) {
          unsent();
          return `${provider}: model was not set: ${messageOf(why)}`;
        }
      }
      if (key.startsWith('acp.')) {
        const id = key.slice('acp.'.length);
        try {
          // Opened before the option is looked for, as with the model: the
          // server names its options on `session/new`, so a session that has
          // not opened has not been told what may be set. Inside the guard,
          // because an open that failed is this key failing too.
          const held = await open();
          const option = controlOptions().find((one) => one.id === id);
          if (option === undefined) return `${provider}: this ACP server names no "${id}" option`;
          if (option.type === 'boolean' && typeof value !== 'boolean') return `${provider}: ${key} takes true or false`;
          if (option.type === 'select' && typeof value !== 'string') return `${provider}: ${key} takes a string`;
          if (typeof value !== 'string' && typeof value !== 'boolean') return `${provider}: ${key} takes a string or true or false`;
          // Built for the option's own kind, which the guards above have said:
          // a boolean goes as a boolean and a select as one of its values.
          sent = { key, before: settings[key] };
          settings[key] = value;
          const answer = option.type === 'boolean'
            ? await held.connection.setSessionConfigOption({ sessionId: held.sessionId, configId: option.id, type: 'boolean', value: value === true })
            : await held.connection.setSessionConfigOption({ sessionId: held.sessionId, configId: option.id, value: String(value) });
          learnOffers(answer.configOptions);
          touch();
          return true;
        }
        catch (why: unknown) {
          unsent();
          return `${provider}: ${key} was not set: ${messageOf(why)}`;
        }
      }
      return `${provider}: ${key} is not a config key this backend serves`;
    },

    // Nothing here has a runtime switch and there are no MCP servers, so all
    // three refuse. False is a real answer: a control that reported success
    // and changed nothing would be worse than one that says no.
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    settings: () => ({ ...settings }),

    close: async (): Promise<void> => {
      closed = true;
      /*
       * Everything anybody is still waiting on is let go first.
       *
       * A permission is a subprocess blocked on a promise, and a shell the
       * server asked for is a process this host opened: closing the connection
       * without answering either leaves the first hanging and the second
       * running under nobody.
       */
      for (const held of permissions.values()) held.settle('cancelled');
      permissions.clear();
      for (const held of terminals.values()) held.handle.release();
      terminals.clear();
      const connection = live;
      live = undefined;
      /*
       * The server is told first, where it advertised it can be told.
       *
       * A server that frees its own resources on `session/close` never gets to
       * do so if the pipe is closed under it mid-release, so the request goes
       * first and is given a bounded moment to be answered. Bounded rather than
       * awaited outright: a server that advertises the capability and never
       * answers it must not hold a close open.
       */
      const saying = connection !== undefined && closes && acpSessionId !== undefined
        ? Promise.race([
            connection.closeSession(acpSessionId).catch(() => {}),
            new Promise((resolve) => { setTimeout(resolve, CLOSE_GRACE_MS).unref(); }),
          ])
        : undefined;
      // The catalogue's record is deliberately kept: the server still holds the
      // conversation and the transcript a row opens onto is this process's own
      // record of it. Only the live connection goes.
      // A turn still open has nobody left to answer it.
      if (active !== undefined) finish(String(active.id), 'cancelled');
      // The connection goes last, and settles on the server's processes being
      // gone rather than on the request having been sent.
      await saying;
      await connection?.close();
    },
  };
}
