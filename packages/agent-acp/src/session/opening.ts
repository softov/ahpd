import { RequestError } from '@agentclientprotocol/sdk';
import type { AgentCapabilities, McpServer as AcpMcpServer } from '@agentclientprotocol/sdk';
import { machineAsked } from '@ahpd/sdk';
import type { Spawn, Start, ToolsEndpoint } from '@ahpd/sdk';
import { watchSession } from '../catalog.js';
import { connectAcp } from '../connection.js';
import type { AcpConnection } from '../types.js';
import { messageOf } from './common.js';
import type { SessionContext } from './context.js';

/** Spawning the server, signing in and opening the one session on it. */
export interface Opening {
  open(): Promise<{ connection: AcpConnection; sessionId: string }>;
  signInFailure(why: unknown): { errorType: string; message: string } | undefined;
}

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
 * One host server as `session/new` names it.
 *
 * ACP spells an HTTP server as a URL and a list of headers rather than as the
 * map of headers VS Code's key holds, so the token goes over as the one header
 * it is: `ahp` is the name the in-process server carries, and a server that
 * already has one by that name is being told about the same tools twice.
 */
const HOST_TOOLS = 'ahp';

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

export function createOpening(ctx: SessionContext): Opening {
  const { options, provider, start, where, replay } = ctx;

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
   *
   * `placed` says the server runs in a machine, where the preset's machine
   * variables are set too and `authenticateInMachine` is the one sent.
   */
  const signIn = async (connection: AcpConnection, placed: boolean): Promise<void> => {
    const asked = placed ? options.authenticateInMachine ?? options.authenticate : options.authenticate;
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
    if (ctx.opening !== undefined) return ctx.opening;
    ctx.loading = true;
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
          update: ctx.receivedUpdate,
          permission: ctx.askPermission,
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
                createTerminal: ctx.openTerminal,
                terminalOutput: ctx.terminalOutput,
                waitForTerminalExit: ctx.waitForTerminalExit,
                killTerminal: ctx.killTerminal,
                releaseTerminal: ctx.releaseTerminal,
              }),
        },
      });
      ctx.live = connection;
      // A server that dies between turns is let go, so the next turn spawns
      // another rather than prompting a process that is no longer there.
      void connection.ended.then(() => {
        if (ctx.live !== connection) return;
        ctx.live = undefined;
        ctx.opening = undefined;
      });
      const handshake = await connection.initialize();
      ctx.closes = advertised(handshake.agentCapabilities?.sessionCapabilities?.close);
      ctx.takes = handshake.agentCapabilities?.promptCapabilities ?? undefined;
      extras = advertised(handshake.agentCapabilities?.sessionCapabilities?.additionalDirectories);
      signIns = (handshake.authMethods ?? []).map((one) => one.id);
      await signIn(connection, moved !== undefined);
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
        handshake.agentCapabilities,
        options.hostTools !== false,
        moved === undefined ? undefined : machineAsked(start),
        (line) => options.log?.(line),
      );
      /*
       * The conversation to continue: the one a resume named, or the one this
       * session already had when its server died. Both go through the same
       * call, because they are the same thing - a conversation this bridge has
       * to hand back to a server rather than start again.
       */
      const reopen = start.resume ?? ctx.acpSessionId;
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
        ctx.acpSessionId = reopen;
        ctx.learnModes(loaded.modes);
        ctx.learnOffers(loaded.configOptions);
        ctx.learnModels(loaded);
      }
      else {
        const created = await connection.newSession({
          cwd: where,
          mcpServers: servers,
          ...extra,
        });
        ctx.acpSessionId = created.sessionId;
        ctx.learnModes(created.modes);
        ctx.learnOffers(created.configOptions);
        ctx.learnModels(created);
      }
      /*
       * The catalogue's record starts here, where the server has named the
       * session and what it said is known. The turn already running is attached
       * because `begin` opens it before the server does, and a transcript that
       * dropped the first turn would be a conversation missing its question.
       */
      ctx.record = watchSession({
        provider,
        id: ctx.acpSessionId,
        cwd: where,
        additional: start.additional ?? [],
        title: ctx.title,
        replay,
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
    // The replay ends where the open does, whether it worked or not: what the
    // server said on the way belongs to no turn after this point.
    const opened = (): void => { ctx.loading = false; };
    void pending.then(opened, opened);
    return pending;
  };

  return { open, signInFailure };
}