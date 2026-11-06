import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentCapabilities, McpServer as AcpMcpServer } from '@agentclientprotocol/sdk';
import { machineAsked, machinePathOf } from '@ahpd/sdk';
import type { Spawn, Start, ToolsEndpoint } from '@ahpd/sdk';
import { heardCapabilities, watchSession } from '../catalog.js';
import { connectAcp } from '../connection.js';
import { HOST_TOOLS } from '../mapping.js';
import type { AcpConnection, AcpOptions } from '../types.js';
import { messageOf } from './common.js';
import type { SessionContext } from './context.js';

/** Spawning the server, signing in and opening the one session on it. */
export interface Opening {
  open(): Promise<{ connection: AcpConnection; sessionId: string }>;
  authenticationFailure(why: unknown): { errorType: string; message: string } | undefined;
  /**
   * Read the record again, and put a new server behind the conversation when
   * what it spawns with changed.
   *
   * Called as the session is created and at the start of every turn. Answers
   * a sentence when the record can no longer be used, which is the turn's own
   * refusal, and nothing otherwise.
   */
  refreshOptions(): string | undefined;
  /**
   * The host's own tools endpoint, once the session's open has opened it.
   *
   * Asked rather than kept, because it is opened inside the first `session/new`
   * and a session whose server has not opened has none. What asks is the offering
   * being replaced: a client that arrives or goes moves the list the agent was
   * handed, and the endpoint is the only thing serving it.
   */
  toolsEndpoint(): ToolsEndpoint | undefined;
}

/**
 * The options a spawned server is built from, which an edit is compared on.
 *
 * A model is not here: ACP carries the model choice as a session config the
 * server owns, and the value reaches a turn through the agent's defaults rather
 * than through the spawn. A provider, a name and a description are the record's
 * own row, which a running session does not get to change.
 */
const SPAWN_KEYS = [
  'command', 'args', 'env', 'cwd', 'authenticate', 'authenticateInMachine',
  'hostTools', 'honoursTrust', 'toolsChanged', 'machine',
] as const;

/** Every field a record may change, which a fresh read puts on the options a session holds. */
const LIVE_KEYS = [
  'command', 'args', 'env', 'cwd', 'provider', 'displayName', 'description', 'model',
  'authenticate', 'authenticateInMachine', 'hostTools', 'honoursTrust', 'toolsChanged', 'machine', 'variant',
  'cutTurns', 'stderrTail', 'modesFrom',
] as const;

/** What a spawned server is built from, as one string to compare an edit by. */
const spawnOf = (one: AcpOptions): string =>
  JSON.stringify(SPAWN_KEYS.map((key) => [key, (one as unknown as Record<string, unknown>)[key]]));

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
 * The hosts that name this machine itself, wherever the address is read.
 *
 * A loopback address is the reader's own, and a wildcard bind is the address a
 * daemon listens on rather than one anything connects to: inside a container
 * either one is the container.
 */
const SELF_ONLY = new Set(['localhost', '0.0.0.0', '[::]', '[::1]']);

/**
 * Whether a session running at `where` can reach the host's tools at `url`.
 *
 * `where` is the machine the session runs in, as its `computer://<id>`, or
 * nothing for this host, which reaches the daemon at whatever address it
 * serves. In a machine the answer is `false` for a loopback or wildcard
 * address and `true` for any other, which is a guess about the network rather
 * than an answer from the machine; this is the one place it is made, so a
 * reachable address the machine's port reports can replace it.
 */
export const toolsReachable = (url: string, where: string | undefined): boolean => {
  if (where === undefined) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  }
  catch {
    return false;
  }
  return !SELF_ONLY.has(host) && !/^127\./u.test(host);
};

/** Where a URL's server is, as `host:port`, with nothing of its path or credentials. */
const addressOf = (url: string): string => {
  try {
    return new URL(url).host;
  }
  catch {
    return 'an address that is not a URL';
  }
};

/**
 * The MCP servers a session is opened with, in ACP's shape.
 *
 * The host's own map, less whatever the handshake says this server cannot take,
 * plus the host's tools as one HTTP server when `hostTools` is on and the
 * session can reach them from `where` it runs. A server left out is said rather
 * than dropped, because a deployment that configured a server and watches a
 * session not reach it has no other way to find out.
 */
const serversFor = (
  start: Start,
  own: () => ToolsEndpoint | undefined,
  capabilities: AgentCapabilities | undefined,
  hostTools: boolean,
  where: string | undefined,
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
  if (!toolsReachable(endpoint.url, where)) {
    say(`host tools: ${String(where)} cannot reach the daemon at ${addressOf(endpoint.url)}, so they were left out`);
    return taken;
  }
  // ACP spells an HTTP server as a URL and a list of headers, so the token goes
  // over as the one header it is.
  taken.push({
    type: 'http',
    name: HOST_TOOLS,
    url: endpoint.url,
    headers: [{ name: 'authorization', value: `Bearer ${endpoint.token}` }],
  });
  return taken;
};

/**
 * The machine this session was told to run in, as its id, or nothing.
 *
 * A name that cannot be reached throws rather than falling back to this host: a
 * session that asked for a sandbox and silently ran outside one is worse than
 * one that did not start. The reading is shared by the server's own spawn and
 * by every terminal the server asks for, so both name the same machine - and a
 * host with no computers port is refused for both, since neither can reach it.
 */
export const machineIdOf = (start: Start): string | undefined => {
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
  return id;
};

/**
 * The JSON-RPC code the protocol's `auth_required` carries, read off the SDK
 * rather than written out, because a code this file recognises by hand is a
 * code it stops recognising if the protocol moves it.
 */
const AUTH_REQUIRED = RequestError.authRequired().code;

export function createOpening(ctx: SessionContext): Opening {
  const { options, provider, start, cwd, replay } = ctx;

  /**
   * The host's own tools, as the one HTTP server this session hands its agent.
   *
   * Asked for once and kept: the endpoint answers with a token of its own, and
   * a server that dies is opened again with the same endpoint, so asking per
   * open would leave the process behind the first one answering for a session
   * nothing is listening to.
   *
   * The runner goes with it, because some of the tools in that list are a
   * client's: the server has nothing to run one of those with, and the session
   * is the only thing that knows which client owns which tool and how to ask
   * it.
   *
   * `toolsChanged` goes with it too, and defaults to `notify` here rather than
   * to the tool server's own `list`: the list this session serves holds a
   * client's tools, and a client arriving mid-turn is the ordinary case rather
   * than a rare one. A deployment that would rather its agents re-listed than
   * be interrupted sets `list`.
   *
   * `mayRun` goes with it because the agent calls that server directly: a call
   * never passes through this bridge, so the server is the one place a person
   * can be asked before a tool of the host's runs.
   */
  let endpoint: ToolsEndpoint | undefined;
  let asked = false;
  const toolsServer = (): ToolsEndpoint | undefined => {
    if (!asked) {
      endpoint = start.toolsServer?.({
        runClient: ctx.ranByClient,
        toolsChanged: options.toolsChanged ?? 'notify',
        mayRun: ctx.askTool,
      });
      asked = true;
    }
    return endpoint;
  };

  /** Whether the server said it can be given directories beside the one it runs in. */
  let extras = false;
  /**
   * The ids of the `authMethods` the server's `initialize` answer offered.
   *
   * A server names them once, at the start of a connection, and an error that
   * arrives later has to name them itself: the sentence that says which way
   * to sign in is the whole of what a person is given.
   */
  let authMethods: string[] = [];

  /**
   * The machine this session was told to run in, as something to spawn.
   *
   * A session whose settings name a computer runs the server there, through
   * the port the host carries. A name that cannot be
   * reached throws rather than falling back to this host: a session that asked
   * for a sandbox and silently ran outside one is worse than one that did not
   * start.
   */
  const placed = async (): Promise<Spawn | undefined> => {
    const id = machineIdOf(start);
    if (id === undefined) return undefined;
    // Said again so the type knows what `machineIdOf` has already guaranteed:
    // a session with no computers port was refused there and never reaches this.
    const computers = start.computers;
    if (computers === undefined) {
      throw new Error(`This session asked to run in ${id}, and this host has no computer plugin to run it in`);
    }
    /*
     * No `cwd` here: the session's `cwd` is this host's directory, and the only
     * paths that mean anything inside the machine are its own. The port uses
     * the machine's working directory when the caller names none.
     */
    const spawn = await computers.how(id, {
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
   *
   * `placed` says the server runs in a machine, where the preset's machine
   * variables are set too and `authenticateInMachine` is the one sent.
   */
  const authenticate = async (connection: AcpConnection, placed: boolean): Promise<void> => {
    const asked = placed ? options.authenticateInMachine ?? options.authenticate : options.authenticate;
    if (asked === undefined) return;
    if (!authMethods.includes(asked.methodId)) {
      const offered = authMethods.join(', ');
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
   * from the `initialize` answer, which is the only place they are ever named.
   */
  const authenticationFailure = (why: unknown): { errorType: string; message: string } | undefined => {
    if (!(why instanceof RequestError) || why.code !== AUTH_REQUIRED) return undefined;
    const offered = authMethods.length === 0 ? 'offers no sign-in method' : `offers ${authMethods.join(', ')}`;
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
   * another. A failure clears it and stops the server it spawned, so the next
   * turn tries again.
   *
   * A fork is asked first and is the one case that copies rather than
   * continues: the conversation it was given stays where it is and this session
   * gets one of its own, from a server that advertised `session.fork`.
   *
   * A resume and a reopen after a death both continue a conversation rather
   * than start one, and which call continues it is the server's own answer.
   * `session/resume` takes it back with nothing replayed, and is chosen when
   * the server advertised it and the host already holds the conversation -
   * a resume that replays a conversation the host has is a conversation every
   * client draws twice. Otherwise `session/load`, whose replay is the only
   * record of a conversation this process never watched, and which the reopen
   * after a death goes through when there is nothing better. A server that
   * advertised neither cannot be continued at all, and says so rather than
   * silently starting a new conversation with nothing on screen about it.
   */
  const open = (): Promise<{ connection: AcpConnection; sessionId: string }> => {
    if (ctx.opening !== undefined) return ctx.opening;
    ctx.loading = true;
    /*
     * The config every client holds as the open begins, read before the open
     * learns the server's own: `learnModes`, `learnConfigOptions` and
     * `learnModels` write the server's values over the session's, and the
     * session's own are what the open sends.
     */
    const values = { ...ctx.values };
    /** The server this open spawned, once it has. */
    let made: AcpConnection | undefined;
    const pending = (async () => {
      /*
       * A folder the host did not vouch for, and an agent that loads the
       * folder's own hooks and settings unchecked.
       *
       * ACP carries no trust field and this host reads none of a project's
       * files for an ACP agent, so what a folder holds reaches the agent
       * whatever this bridge does with it. Not starting the agent there is the
       * one thing left, unless the preset says its agent asks before it loads
       * the folder's own configuration - and an absent `Start.trusted` is the
       * host having said nothing, which is the same answer as untrusted.
       */
      if (options.honoursTrust !== true && start.trusted?.(cwd) !== true) {
        throw new Error(`${provider}: ${cwd} is not a folder this host trusts, and an ACP agent loads a project's own settings and hooks from the folder it runs in; trust the folder, or set honoursTrust on this preset if its agent asks before it loads them`);
      }
      const moved = await placed();
      /*
       * The folder as the agent reaches it: the host's own for an agent on this
       * host, and its machine path for one in a machine - the same text on
       * Linux and macOS, drive-style on Windows. The catalogue's record below
       * keeps the host's, since that is the folder a client named.
       */
      const told = moved === undefined ? cwd : machinePathOf(cwd);
      const connection = connectAcp({
        command: moved?.command ?? options.command,
        ...(moved !== undefined
          ? { args: moved.args }
          : options.args === undefined ? {} : { args: options.args }),
        ...(moved?.env !== undefined
          ? { env: moved.env }
          : moved === undefined && options.env !== undefined ? { env: options.env } : {}),
        ...(moved?.cwd !== undefined ? { cwd: moved.cwd } : moved === undefined ? { cwd } : {}),
        handlers: {
          update: ctx.sessionUpdate,
          permission: ctx.requestPermission,
          // A question needs nothing but a chat to put it on, so both of these
          // are always here rather than behind a capability the host might not
          // have sent.
          elicitation: ctx.askElicitation,
          elicitationComplete: ctx.heardElicitationComplete,
          // Where a server's account goes, for a host that keeps one per agent.
          ...(start.onAccount === undefined ? {} : { account: start.onAccount }),
          // Each half only where the session has what it needs: an
          // unadvertised capability is a request a conformant server never
          // makes, and one with nothing behind it would throw.
          ...(start.resources === undefined
            ? {}
            : {
                readTextFile: ctx.readTextFile,
                ...(start.resources.write === undefined ? {} : { writeTextFile: ctx.writeTextFile }),
              }),
          ...(start.terminals === undefined
            ? {}
            : {
                createTerminal: ctx.createTerminal,
                terminalOutput: ctx.terminalOutput,
                waitForTerminalExit: ctx.waitForTerminalExit,
                killTerminal: ctx.killTerminal,
                releaseTerminal: ctx.releaseTerminal,
              }),
        },
        ...(options.log === undefined ? {} : { log: options.log }),
      });
      ctx.live = connection;
      made = connection;
      // A server that dies between turns is let go, so the next turn spawns
      // another rather than prompting a process that is no longer there.
      void connection.ended.then(() => {
        if (ctx.live !== connection) return;
        ctx.live = undefined;
        ctx.opening = undefined;
      });
      const initializeResponse = await connection.initialize();
      const { agentCapabilities } = initializeResponse;
      ctx.closes = advertised(agentCapabilities?.sessionCapabilities?.close);
      ctx.loads = agentCapabilities?.loadSession === true;
      ctx.resumes = advertised(agentCapabilities?.sessionCapabilities?.resume);
      ctx.forks = advertised(agentCapabilities?.sessionCapabilities?.fork);
      // And for the agent, which offers a fork only where its server can make one.
      heardCapabilities(options, agentCapabilities);
      ctx.promptCapabilities = agentCapabilities?.promptCapabilities ?? undefined;
      extras = advertised(agentCapabilities?.sessionCapabilities?.additionalDirectories);
      authMethods = (initializeResponse.authMethods ?? []).map((one) => one.id);
      await authenticate(connection, moved !== undefined);
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
       * HTTP server unless the deployment turned that off or the machine the
       * session runs in cannot reach them.
       */
      const servers = serversFor(
        start,
        toolsServer,
        agentCapabilities,
        options.hostTools !== false,
        moved === undefined ? undefined : machineAsked(start),
        (line) => options.log?.(line),
      );
      /*
       * The conversation to continue: the one this session already had when
       * its server died, or else the one a resume named. Both go through the
       * same call, because they are the same thing - a conversation this
       * bridge has to hand back to a server rather than start again.
       *
       * The session's own id comes first, because after a fork it is the copy
       * and not the conversation `start.resume` names.
       */
      const died = ctx.acpSessionId !== undefined;
      const reopen = ctx.acpSessionId ?? start.resume;
      /*
       * A fork copies the conversation into a new one of its own.
       *
       * Asked first, because it is the one case where the session the server
       * is left with is not the one it was handed: the old conversation stays
       * where it is and this session gets a copy. What the host named is the
       * turn to copy through, and this server can only be asked for the whole
       * of what it holds - so a fork at any turn but the last one behind the
       * conversation is refused rather than served as a copy of something
       * else. The control is not offered for such a turn either, which is why
       * this is a caller out of step rather than a person's mistake.
       *
       * Only the first open forks. A reopen after a death continues the copy
       * the fork made, and never forks again.
       */
      if (start.forkAt !== undefined && !died) {
        if (start.resume === undefined) {
          throw new Error(`${provider}: a fork names the conversation it copies, and this one named no session`);
        }
        if (!ctx.forks) {
          throw new Error(`${provider}: this ACP server cannot fork a session, so "${start.resume}" cannot be copied`);
        }
        const last = ctx.turns.at(-1);
        if (String(last?.id ?? '') !== start.forkAt) {
          throw new Error(`${provider}: "${start.forkAt}" is not the last turn of "${start.resume}", and a fork copies the whole conversation rather than part of it`);
        }
        const copied = await connection.forkSession({
          sessionId: start.resume,
          cwd: told,
          mcpServers: servers,
          ...extra,
        });
        ctx.acpSessionId = copied.sessionId;
        ctx.learnModes(copied.modes);
        ctx.learnConfigOptions(copied.configOptions);
        ctx.learnModels(copied);
        await ctx.sendAsked({ connection, sessionId: copied.sessionId }, values);
      }
      else if (reopen !== undefined) {
        /*
         * A resume is taken back rather than replayed only where the host holds
         * the conversation already.
         *
         * `Start.seed` is the turns the host has, and a server that replays the
         * same ones is a conversation every client draws twice - which is the
         * whole of what `session/resume` exists for. With no seed there is
         * nothing on this side of the wire and the replay is the only record,
         * so the load is what is wanted even where the server offers both.
         *
         * A reopen after a death is the other case: the record is this
         * process's own, so nothing is replayed for it either.
         */
        const held = start.seed ?? [];
        const taking = ctx.resumes && (died || held.length > 0);
        if (!taking && !ctx.loads) {
          throw new Error(died
            ? `${provider}: the server died and this one cannot load a session, so "${reopen}" cannot be continued`
            : `${provider}: this ACP server cannot load a session, so "${reopen}" cannot be resumed`);
        }
        const request = {
          sessionId: reopen,
          cwd: told,
          mcpServers: servers,
          ...extra,
        };
        const taken = taking
          ? await connection.resumeSession(request)
          : await connection.loadSession(request);
        ctx.acpSessionId = reopen;
        ctx.learnModes(taken.modes);
        ctx.learnConfigOptions(taken.configOptions);
        ctx.learnModels(taken);
        await ctx.sendAsked({ connection, sessionId: reopen }, values);
      }
      else {
        const created = await connection.newSession({
          cwd: told,
          mcpServers: servers,
          ...extra,
        });
        ctx.acpSessionId = created.sessionId;
        ctx.learnModes(created.modes);
        ctx.learnConfigOptions(created.configOptions);
        ctx.learnModels(created);
        await ctx.sendAsked({ connection, sessionId: created.sessionId }, values);
      }
      /*
       * The server has now said what it serves, so the host can read
       * `Session.models` and put the list on the agent, as agent-claude and
       * agent-pi do. Without this a client is never offered a model.
       */
      ctx.start.onHandshake?.();
      /*
       * The catalogue's record starts here, where the server has named the
       * session and what it said is known. The turn already running is attached
       * because `sendMessage` starts it before the server does, and a
       * transcript that dropped the first turn would be a conversation missing
       * its question.
       *
       * The host's own turns go with it for the same reason: a resume and a
       * fork both replay nothing, so without them the record would hold a
       * conversation that starts at whatever the person says next.
       */
      ctx.record = watchSession({
        provider,
        id: ctx.acpSessionId,
        cwd,
        additional: start.additional ?? [],
        title: ctx.title,
        replay,
        seed: start.seed ?? [],
      });
      /*
       * The record has it now, and this list must not keep it: a server that
       * dies and is reopened replays the whole conversation again, and a list
       * that still held the first replay would push it a second time.
       */
      replay.length = 0;
      if (ctx.watchedTurn !== undefined && !ctx.record.turns.includes(ctx.watchedTurn)) ctx.record.turns.push(ctx.watchedTurn);
      return { connection, sessionId: ctx.acpSessionId };
    })();
    ctx.opening = pending;
    /*
     * The replay ends where the open does, whether it worked or not: what the
     * server said on the way belongs to no turn after this point. What the
     * open learned is said then, where it differs from the config every client
     * held as it began: the mode, the options and the model the server runs
     * with, once the values the session holds have been sent.
     */
    const opened = (): void => {
      ctx.loading = false;
      ctx.syncConfig(values);
    };
    void pending.then(opened, opened);
    /*
     * An open that fails lets go of itself and of the server it spawned, so a
     * server that refused the session or its sign-in leaves no process behind
     * and the next open spawns one of its own.
     */
    void pending.catch(() => {
      if (ctx.opening === pending) ctx.opening = undefined;
      if (made === undefined) return;
      if (ctx.live === made) ctx.live = undefined;
      void made.close();
    });
    return pending;
  };

  /**
   * Read the record again, and put a new server behind the conversation when
   * what it spawns with changed.
   *
   * An edit applies at the next turn, which is the whole of the promise: the
   * turn already running finishes on the server it started on, and the turn
   * that begins after the edit is answered by a server built from what the
   * record says now. Nothing to do for a preset, whose values no running daemon
   * can edit.
   *
   * The conversation is kept by leaving `acpSessionId` where it is and letting
   * the old server go, so `open` reopens it the way it reopens one that died -
   * a resume where the server advertised that it can take one back without
   * replaying, and a load otherwise. The session's creation reads what its
   * first server is built with, so an edit made after that is one the next
   * turn spawns a server for.
   *
   * A record that can no longer be used is the turn's own refusal rather than a
   * session that died, which is why it comes back as a sentence.
   */
  const refreshOptions = (): string | undefined => {
    const live = options.presetOf;
    if (live === undefined) return undefined;
    let now: AcpOptions;
    try {
      now = live();
    }
    catch (error: unknown) {
      return `${provider}: the record cannot be used: ${messageOf(error)}`;
    }
    const holding = options as unknown as Record<string, unknown>;
    for (const key of LIVE_KEYS) {
      const value = (now as unknown as Record<string, unknown>)[key];
      if (value === undefined) delete holding[key];
      else holding[key] = value;
    }
    const said = spawnOf(now);
    if (ctx.startedWith === '' || said === ctx.startedWith) {
      ctx.startedWith = said;
      return undefined;
    }
    ctx.startedWith = said;
    const was = ctx.live;
    ctx.live = undefined;
    ctx.opening = undefined;
    // The conversation is kept by `acpSessionId`, so the old server is only
    // stopped: awaiting that close here would hold the turn on a process that
    // is no longer answering for it.
    void was?.close().catch(() => {});
    return undefined;
  };

  return { open, refreshOptions, authenticationFailure, toolsEndpoint: () => endpoint };
}